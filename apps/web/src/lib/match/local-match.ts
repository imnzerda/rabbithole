import {
  applyAction,
  chooseAction,
  createMatch,
  EngineError,
  getPlayerView,
  pendingDecision,
  Rng,
  timeoutAction,
  type GameAction,
  type MatchContext,
  type MatchEvent,
  type MatchState,
  type PlayerView,
} from '@rabbithole/engine';
import { BaseMatchClient, type MatchClient } from './client';

const ME = 0;
const AI = 1;

/** Seed aléatoire forte. Entraînement local uniquement : en ligne, la seed vient du serveur. */
function randomSeed(): string {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(8, '0')).join('');
}

export interface DeckChoice {
  leader: string;
  cards: string[];
}

/**
 * Partie d'entraînement contre l'IA, entièrement dans le navigateur (aucun enjeu).
 * L'UI n'accède qu'à la vue du joueur, exactement comme face au serveur.
 */
export class LocalMatch extends BaseMatchClient implements MatchClient {
  readonly spectator = false;
  readonly opponentName = 'IA';
  private state: MatchState;
  private readonly ai: Rng;
  private initialEvents: MatchEvent[];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    readonly ctx: MatchContext,
    mine: DeckChoice,
    theirs: DeckChoice,
    private readonly timers: boolean,
    seed: string = randomSeed(),
  ) {
    super();
    this.ai = Rng.fromSeed(`${seed}:ai`);
    const { state, events } = createMatch(ctx, {
      seed,
      players: [
        { id: 'me', leader: mine.leader, deck: mine.cards },
        { id: 'ai', leader: theirs.leader, deck: theirs.cards },
      ],
    });
    this.state = state;
    this.initialEvents = events;
  }

  get view(): PlayerView {
    return getPlayerView(this.ctx, this.state, ME);
  }

  private deadline(): number | null {
    const d = pendingDecision(this.state);
    if (!this.timers || !d || d.player !== ME) return null;
    const s = d.kind === 'main' ? this.ctx.rules.turnTimerSeconds : this.ctx.rules.reactionTimerSeconds;
    return Date.now() + s * 1000;
  }

  private emit(events: MatchEvent[]): void {
    this.emitStep({ events, view: this.view, deadline: this.deadline() });
  }

  start(): void {
    queueMicrotask(() => {
      this.emit(this.initialEvents);
      this.initialEvents = [];
      this.runAi();
      this.arm();
    });
  }

  private apply(player: 0 | 1, action: GameAction): void {
    const result = applyAction(this.ctx, this.state, player, action);
    this.state = result.state;
    this.emit(result.events);
  }

  /** L'IA joue tant que c'est à elle de décider. */
  private runAi(): void {
    for (let guard = 0; guard < 200 && !this.closed; guard++) {
      const d = pendingDecision(this.state);
      if (!d || d.player !== AI) break;
      const action = chooseAction(this.ctx, this.state, AI, this.ai);
      if (!action) break;
      this.apply(AI, action);
    }
  }

  /** Minuteur local : action par défaut à l'expiration (même règle que le serveur). */
  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    const deadline = this.deadline();
    if (deadline === null || this.closed) return;
    this.timer = setTimeout(() => {
      const fallback = timeoutAction(this.state);
      if (!fallback || fallback.player !== ME) return;
      this.act(fallback.action);
    }, deadline - Date.now());
  }

  act(action: GameAction): void {
    if (this.closed) return;
    try {
      this.apply(ME, action);
    } catch (error) {
      this.emitError({ code: error instanceof EngineError ? error.code : 'error', message: String((error as Error).message) });
      return;
    }
    this.runAi();
    this.arm();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
