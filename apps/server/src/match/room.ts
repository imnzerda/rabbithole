import {
  applyAction,
  chooseAction,
  createMatch,
  EngineError,
  eventsFor,
  getPlayerView,
  pendingDecision,
  Rng,
  timeoutAction,
  type GameAction,
  type MatchContext,
  type MatchEvent,
  type MatchState,
  type PlayerIndex,
} from '@rabbithole/engine';
import type { PlayerCosmetics, QueueMode, RankedResultDto, ServerMessage } from '@rabbithole/shared';

export type Send = (message: ServerMessage) => void;

const NO_COSMETICS: PlayerCosmetics = { variants: {}, title: null };

export interface SeatInfo {
  /** `null` pour un fantôme (IA). */
  userId: string | null;
  name: string;
  leader: string;
  deck: string[];
  /** Variantes et titre affichés (fantôme : ceux du joueur dont il joue le deck). */
  cosmetics?: PlayerCosmetics;
}

export interface RoomTimers {
  turnMs: number;
  reactionMs: number;
}

export interface RoomOptions {
  id: string;
  mode: QueueMode;
  seed: string;
  ctx: MatchContext;
  /** Version du catalogue de la partie. */
  contentVersion: string;
  seats: [SeatInfo, SeatInfo];
  /** Cartes en tendance pendant la partie (bonus Tendance, section 8). */
  trending?: string[];
  timers: RoomTimers;
  onEnd: (room: MatchRoom) => void;
}

/**
 * Une partie en cours. Le serveur fait foi : chaque action est validée par le moteur,
 * chaque joueur ne reçoit que sa vue et des événements filtrés, les minuteurs sont ici.
 */
export class MatchRoom {
  readonly id: string;
  readonly mode: QueueMode;
  readonly seed: string;
  readonly seats: [SeatInfo, SeatInfo];
  readonly actions: { player: PlayerIndex; action: GameAction }[] = [];
  state: MatchState;
  deadline: number | null = null;
  readonly ctx: MatchContext;
  private readonly contentVersion: string;
  private readonly timers: RoomTimers;
  private readonly onEnd: (room: MatchRoom) => void;
  private readonly sends: [Send | null, Send | null] = [null, null];
  private readonly ghostRng: Rng;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private initialEvents: MatchEvent[];
  private closed = false;
  /** Pièces créditées à chaque joueur, connues après l'enregistrement de la partie. */
  private rewards: [number | null, number | null] = [null, null];
  private ranked: [RankedResultDto | null, RankedResultDto | null] = [null, null];
  private announced = false;

  constructor(o: RoomOptions) {
    this.id = o.id;
    this.mode = o.mode;
    this.seed = o.seed;
    this.seats = o.seats;
    this.ctx = o.ctx;
    this.contentVersion = o.contentVersion;
    this.timers = o.timers;
    this.onEnd = o.onEnd;
    this.ghostRng = Rng.fromSeed(`${o.seed}:ghost`);
    const { state, events } = createMatch(o.ctx, {
      seed: o.seed,
      trendingCardIds: o.trending ?? [],
      players: [
        { id: o.seats[0].userId ?? 'ghost', leader: o.seats[0].leader, deck: o.seats[0].deck },
        { id: o.seats[1].userId ?? 'ghost', leader: o.seats[1].leader, deck: o.seats[1].deck },
      ],
    });
    this.state = state;
    this.initialEvents = events;
  }

  get ended(): boolean {
    return this.state.phase === 'ended';
  }

  seatOf(userId: string): PlayerIndex | null {
    if (this.seats[0].userId === userId) return 0;
    if (this.seats[1].userId === userId) return 1;
    return null;
  }

  isGhost(p: PlayerIndex): boolean {
    return this.seats[p].userId === null;
  }

  /** Branche (ou rebranche, après une déconnexion) la connexion d'un joueur et lui renvoie l'état. */
  attach(userId: string, send: Send): void {
    const p = this.seatOf(userId);
    if (p === null) return;
    this.sends[p] = send;
    const opponent = this.seats[p === 0 ? 1 : 0];
    send({
      t: 'match_start',
      matchId: this.id,
      you: p,
      opponent: { name: opponent.name, ghost: opponent.userId === null, leader: opponent.leader },
      contentVersion: this.contentVersion,
      cosmetics: [this.seats[0].cosmetics ?? NO_COSMETICS, this.seats[1].cosmetics ?? NO_COSMETICS],
    });
    const events = this.initialEvents.length ? eventsFor(this.initialEvents, p) : [];
    send({ t: 'step', matchId: this.id, events, view: getPlayerView(this.ctx, this.state, p), deadline: this.deadline });
    if (this.announced && this.state.result) send({ t: 'match_end', matchId: this.id, result: this.state.result, reward: this.rewards[p], ranked: this.ranked[p] });
  }

  detach(userId: string, send: Send): void {
    const p = this.seatOf(userId);
    if (p !== null && this.sends[p] === send) this.sends[p] = null;
  }

  /** Démarre la partie : le fantôme joue s'il doit décider, puis le minuteur se lance. */
  start(): void {
    this.initialEvents = [];
    this.runGhost();
    this.armTimer();
  }

  /** Action d'un joueur humain. Lève une `EngineError` si elle est illégale. */
  act(userId: string, action: GameAction): void {
    const p = this.seatOf(userId);
    if (p === null) throw new EngineError('not_your_decision', "Tu ne joues pas cette partie.");
    this.apply(p, action);
    this.runGhost();
    this.armTimer();
  }

  private apply(player: PlayerIndex, action: GameAction): void {
    if (this.closed) return;
    const { state, events } = applyAction(this.ctx, this.state, player, action);
    this.state = state;
    this.actions.push({ player, action });
    this.broadcast(events);
    if (this.ended) this.finish();
  }

  private broadcast(events: MatchEvent[]): void {
    for (const p of [0, 1] as PlayerIndex[]) {
      const send = this.sends[p];
      if (!send) continue;
      send({ t: 'step', matchId: this.id, events: eventsFor(events, p), view: getPlayerView(this.ctx, this.state, p), deadline: this.nextDeadline() });
    }
  }

  /** Le fantôme joue tant que c'est à lui de décider. */
  private runGhost(): void {
    for (let guard = 0; guard < 300 && !this.ended; guard++) {
      const d = pendingDecision(this.state);
      if (!d || !this.isGhost(d.player)) return;
      const action = chooseAction(this.ctx, this.state, d.player, this.ghostRng);
      if (!action) return;
      this.apply(d.player, action);
    }
  }

  private nextDeadline(): number | null {
    const d = pendingDecision(this.state);
    if (!d || this.isGhost(d.player)) return null;
    return Date.now() + (d.kind === 'main' ? this.timers.turnMs : this.timers.reactionMs);
  }

  /** Minuteur de la décision en cours : à l'expiration, action par défaut (fin de tour, pas de contre…). */
  private armTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = this.ended ? null : this.nextDeadline();
    if (this.deadline === null) return;
    this.timer = setTimeout(() => {
      const fallback = timeoutAction(this.state);
      if (!fallback || this.closed) return;
      this.apply(fallback.player, fallback.action);
      this.runGhost();
      this.armTimer();
    }, this.deadline - Date.now());
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
    this.onEnd(this);
  }

  /** Fin de partie annoncée une fois la partie enregistrée et les récompenses créditées. */
  announceEnd(rewards: [number | null, number | null], ranked: [RankedResultDto | null, RankedResultDto | null] = [null, null]): void {
    this.rewards = rewards;
    this.ranked = ranked;
    this.announced = true;
    const result = this.state.result!;
    this.sends.forEach((send, p) => send?.({ t: 'match_end', matchId: this.id, result, reward: rewards[p] ?? null, ranked: ranked[p] ?? null }));
  }

  /** Arrêt du serveur : on coupe les minuteurs. */
  dispose(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
