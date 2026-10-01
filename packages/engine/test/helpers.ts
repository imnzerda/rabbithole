import {
  applyAction,
  chooseAction,
  computePowers,
  createContext,
  createMatch,
  legalActions,
  pendingDecision,
  Rng,
  type CardDef,
  type CardInstance,
  type GameAction,
  type MatchContext,
  type MatchEvent,
  type MatchState,
  type PlayerIndex,
  type RulesOverride,
} from '../src/index.js';
import { FILLERS, LEADERS } from './fixtures.js';

/** `'leader'` désigne le Leader du joueur, sinon un identifiant de carte. */
export type Ref = string;

export class Duel {
  events: MatchEvent[] = [];
  allEvents: MatchEvent[] = [];

  constructor(
    readonly ctx: MatchContext,
    public state: MatchState,
    events: MatchEvent[],
  ) {
    this.events = events;
    this.allEvents = [...events];
  }

  // --- Mise en place directe (tests uniquement) -----------------------------

  private instance(p: PlayerIndex, defId: string, zone: CardInstance['zone']): CardInstance {
    const uid = `t${this.state.nextUid++}`;
    const c: CardInstance = {
      uid,
      defId,
      owner: p,
      controller: p,
      zone,
      rested: false,
      playedTurn: 0,
      buzz: 0,
      permMod: 0,
      turnMod: 0,
      battleMod: 0,
      effectsCancelled: false,
      activatedTurn: null,
      token: false,
    };
    this.state.cards[uid] = c;
    return c;
  }

  give(p: PlayerIndex, ...defIds: string[]): this {
    for (const id of defIds) this.state.players[p].hand.push(this.instance(p, id, 'hand').uid);
    return this;
  }

  place(p: PlayerIndex, defId: string, opts: { rested?: boolean; fresh?: boolean } = {}): this {
    const c = this.instance(p, defId, 'field');
    c.rested = !!opts.rested;
    c.playedTurn = opts.fresh ? this.state.turn : 0;
    this.state.players[p].characters.push(c.uid);
    return this;
  }

  setBuzz(p: PlayerIndex, active: number): this {
    this.state.players[p].buzzActive = active;
    return this;
  }

  setLife(p: PlayerIndex, n: number): this {
    const life = this.state.players[p].life;
    while (life.length > n) life.pop();
    while (life.length < n) life.push(this.instance(p, 'filler_0', 'life').uid);
    return this;
  }

  // --- Actions ------------------------------------------------------------

  act(p: PlayerIndex, action: GameAction): this {
    const step = applyAction(this.ctx, this.state, p, action);
    this.state = step.state;
    this.events = step.events;
    this.allEvents.push(...step.events);
    return this;
  }

  uid(p: PlayerIndex, ref: Ref): string {
    if (ref === 'leader') return this.state.players[p].leader;
    const order: CardInstance['zone'][] = ['field', 'hand', 'trash', 'life', 'deck'];
    for (const zone of order) {
      const c = Object.values(this.state.cards).find((x) => x.defId === ref && x.controller === p && x.zone === zone);
      if (c) return c.uid;
    }
    throw new Error(`${ref} introuvable pour le joueur ${p}`);
  }

  card(p: PlayerIndex, ref: Ref): CardInstance {
    return this.state.cards[this.uid(p, ref)]!;
  }

  power(p: PlayerIndex, ref: Ref): number {
    return computePowers(this.ctx, this.state)[this.uid(p, ref)] ?? NaN;
  }

  play(p: PlayerIndex, defId: string): this {
    return this.act(p, { type: 'play', uid: this.uid(p, defId) });
  }

  attack(p: PlayerIndex, attacker: Ref, target: Ref): this {
    const enemy = p === 0 ? 1 : 0;
    return this.act(p, { type: 'attack', attacker: this.uid(p, attacker), target: this.uid(enemy, target) });
  }

  end(p: PlayerIndex = this.state.active): this {
    return this.act(p, { type: 'end_turn' });
  }

  /** Termine des tours jusqu'à atteindre le tour `n`. */
  toTurn(n: number): this {
    while (this.state.turn < n && this.state.phase === 'main') this.end();
    return this;
  }

  get phase(): MatchState['phase'] {
    return this.state.phase;
  }

  eventsOf<T extends MatchEvent['type']>(type: T): Extract<MatchEvent, { type: T }>[] {
    return this.allEvents.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type);
  }
}

export interface SandboxOptions {
  cards?: CardDef[];
  /** Cartes en tête de deck de chaque joueur (les 5 premières forment la main de départ). */
  decks?: [string[], string[]];
  leaders?: [string, string];
  rules?: RulesOverride;
  first?: PlayerIndex;
  seed?: string;
  trending?: string[];
  mulligan?: boolean;
}

export function makeContext(cards: CardDef[] = [], rules?: RulesOverride): MatchContext {
  return createContext({ cards: [...LEADERS, ...FILLERS, ...cards], rules });
}

/** Duel de test : decks non mélangés, complétés par des cartes de remplissage, premier joueur = 0. */
export function sandbox(opts: SandboxOptions = {}): Duel {
  const ctx = makeContext(opts.cards ?? [], opts.rules);
  const fillers = FILLERS.flatMap((f) => [f.id, f.id]);
  const pad = (ids: string[]) => [...ids, ...fillers].slice(0, ctx.rules.deckSize);
  const [la, lb] = opts.leaders ?? ['leader_a', 'leader_b'];
  const { state, events } = createMatch(ctx, {
    seed: opts.seed ?? 'test-seed',
    players: [
      { id: 'A', leader: la, deck: pad(opts.decks?.[0] ?? []) },
      { id: 'B', leader: lb, deck: pad(opts.decks?.[1] ?? []) },
    ],
    first: opts.first ?? 0,
    shuffleDecks: false,
    skipMulligan: !opts.mulligan,
    trendingCardIds: opts.trending,
  });
  return new Duel(ctx, state, events);
}

/** Joueur aléatoire (seedé) : choisit une action légale au hasard, termine son tour de temps en temps. */
export function randomAction(ctx: MatchContext, s: MatchState, p: PlayerIndex, rng: Rng): GameAction {
  const legal = legalActions(ctx, s, p)!;
  switch (legal.kind) {
    case 'mulligan':
      return { type: 'mulligan', redraw: rng.int(2) === 0 };
    case 'block':
      return { type: 'block', blocker: rng.int(2) === 0 ? null : (legal.blockers[rng.int(legal.blockers.length)] ?? null) };
    case 'counter': {
      const pick = legal.counters.filter((o) => !o.event && rng.int(3) === 0).map((o) => o.uid);
      return { type: 'counter', uids: pick };
    }
    case 'trigger':
      return { type: 'trigger', activate: rng.int(2) === 0 };
    case 'main': {
      const options: GameAction[] = [{ type: 'end_turn' }];
      for (const uid of legal.playable) options.push({ type: 'play', uid });
      for (const uid of legal.activatable) options.push({ type: 'activate', uid });
      for (const a of legal.attackers) for (const t of a.targets) options.push({ type: 'attack', attacker: a.uid, target: t });
      for (const t of legal.attachTargets) options.push({ type: 'attach', target: t });
      if (legal.canHype && rng.int(10) === 0) options.push({ type: 'hype' });
      return rng.pick(options);
    }
  }
}

export type Brain = 'ai' | 'random';

/** Partie complète entre deux cerveaux. Renvoie l'état final, les états intermédiaires et les actions. */
export function playOut(
  ctx: MatchContext,
  setup: { seed: string; decks: [{ leader: string; deck: string[] }, { leader: string; deck: string[] }]; mulligan?: boolean },
  brains: [Brain, Brain],
  botSeed: string,
  maxSteps = 2000,
) {
  const rng = Rng.fromSeed(botSeed);
  let { state, events } = createMatch(ctx, {
    seed: setup.seed,
    players: [
      { id: 'A', ...setup.decks[0] },
      { id: 'B', ...setup.decks[1] },
    ],
    skipMulligan: !setup.mulligan,
  });
  const log: MatchEvent[] = [...events];
  const actions: { player: PlayerIndex; action: GameAction }[] = [];
  const states: MatchState[] = [state];
  for (let i = 0; i < maxSteps && state.phase !== 'ended'; i++) {
    const d = pendingDecision(state)!;
    const action = brains[d.player] === 'ai' ? chooseAction(ctx, state, d.player, rng)! : randomAction(ctx, state, d.player, rng);
    ({ state, events } = applyAction(ctx, state, d.player, action));
    log.push(...events);
    actions.push({ player: d.player, action });
    states.push(state);
  }
  return { state, log, actions, states };
}
