import { applyAction, createMatch, getPlayerView, type GameAction, type MatchContext, type MatchState, type PlayerIndex } from '@rabbithole/engine';
import type { ReplayData } from '@rabbithole/shared';
import { BaseMatchClient, type MatchClient } from './client';

/**
 * Relecture d'une partie enregistrée : le moteur rejoue seed + decks + actions,
 * à l'identique, du point de vue d'un des joueurs. Aucune action possible.
 */
export class ReplayMatch extends BaseMatchClient implements MatchClient {
  readonly spectator = true;
  private state: MatchState;
  private index = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private initial: ReturnType<typeof createMatch>['events'];
  playing = true;

  constructor(
    readonly ctx: MatchContext,
    private readonly replay: ReplayData,
    readonly viewer: PlayerIndex,
    private readonly delayMs = 1100,
  ) {
    super();
    const { state, events } = createMatch(ctx, {
      seed: replay.seed,
      trendingCardIds: replay.trending ?? [],
      players: [
        { id: 'a', leader: replay.players[0].leader, deck: replay.players[0].deck },
        { id: 'b', leader: replay.players[1].leader, deck: replay.players[1].deck },
      ],
    });
    this.state = state;
    this.initial = events;
  }

  get opponentName(): string {
    return this.replay.players[this.viewer === 0 ? 1 : 0].name;
  }

  get progress(): { index: number; total: number } {
    return { index: this.index, total: this.replay.actions.length };
  }

  private viewNow() {
    // En relecture, pas d'actions légales : l'UI reste en lecture seule.
    return { ...getPlayerView(this.ctx, this.state, this.viewer), legal: null };
  }

  start(): void {
    queueMicrotask(() => {
      this.emitStep({ events: this.initial, view: this.viewNow(), deadline: null });
      this.resume();
    });
  }

  /** Avance d'une action. Renvoie `false` à la fin de la partie. */
  next(): boolean {
    const entry = this.replay.actions[this.index];
    if (!entry) return false;
    this.index += 1;
    const { state, events } = applyAction(this.ctx, this.state, entry.player, entry.action);
    this.state = state;
    this.emitStep({ events, view: this.viewNow(), deadline: null });
    return true;
  }

  pause(): void {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  resume(): void {
    this.playing = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.next()) this.pause();
    }, this.delayMs);
  }

  act(_action: GameAction): void {
    // Lecture seule.
  }

  close(): void {
    this.pause();
  }
}
