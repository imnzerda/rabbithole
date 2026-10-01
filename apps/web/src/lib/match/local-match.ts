import {
  applyAction,
  chooseAction,
  createMatch,
  getPlayerView,
  pendingDecision,
  Rng,
  type GameAction,
  type MatchContext,
  type MatchEvent,
  type MatchState,
  type PlayerView,
} from '@rabbithole/engine';
import type { MatchClient, MatchStep } from './client';

const ME = 0;
const AI = 1;

/** Seed aléatoire forte. Prototype uniquement : en phase 3, la seed vient du serveur. */
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
 * Partie locale contre l'IA (prototype). Le moteur tourne dans le navigateur,
 * mais l'UI n'accède qu'à la vue du joueur, comme face au serveur.
 */
export class LocalMatch implements MatchClient {
  private state: MatchState;
  private readonly ai: Rng;
  readonly initialSteps: MatchStep[];

  constructor(
    readonly ctx: MatchContext,
    mine: DeckChoice,
    theirs: DeckChoice,
    seed: string = randomSeed(),
  ) {
    this.ai = Rng.fromSeed(`${seed}:ai`);
    const { state, events } = createMatch(ctx, {
      seed,
      players: [
        { id: 'me', leader: mine.leader, deck: mine.cards },
        { id: 'ai', leader: theirs.leader, deck: theirs.cards },
      ],
    });
    this.state = state;
    this.initialSteps = [this.step(events), ...this.runAi()];
  }

  get view(): PlayerView {
    return getPlayerView(this.ctx, this.state, ME);
  }

  private step(events: MatchEvent[]): MatchStep {
    return { events, view: this.view };
  }

  /** L'IA joue tant que c'est à elle de décider. */
  private runAi(): MatchStep[] {
    const steps: MatchStep[] = [];
    for (let guard = 0; guard < 200; guard++) {
      const d = pendingDecision(this.state);
      if (!d || d.player !== AI) break;
      const action = chooseAction(this.ctx, this.state, AI, this.ai);
      if (!action) break;
      const result = applyAction(this.ctx, this.state, AI, action);
      this.state = result.state;
      steps.push(this.step(result.events));
    }
    return steps;
  }

  async act(action: GameAction): Promise<MatchStep[]> {
    const result = applyAction(this.ctx, this.state, ME, action);
    this.state = result.state;
    return [this.step(result.events), ...this.runAi()];
  }
}
