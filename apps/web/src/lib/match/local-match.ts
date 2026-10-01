import {
  aiWantsFold,
  aiWantsHype,
  chooseAiPlays,
  createMatch,
  declareHype,
  fold,
  getPlayerView,
  resolveTurn,
  Rng,
  type MatchContext,
  type MatchEvent,
  type MatchState,
  type Play,
  type PlayerView,
} from '@rabbithole/engine';
import type { MatchClient, MatchUpdate } from './client';

const ME = 0;
const AI = 1;

/** Seed aléatoire forte. Prototype uniquement : en phase 3, la seed vient du serveur. */
function randomSeed(): string {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(8, '0')).join('');
}

/**
 * Partie locale contre l'IA (prototype de la phase 2). Le moteur tourne dans le navigateur ;
 * l'UI n'accède pourtant qu'à la vue du joueur, comme elle le fera face au serveur.
 */
export class LocalMatch implements MatchClient {
  private state: MatchState;
  private readonly ai: Rng;
  readonly initialEvents: MatchEvent[];

  constructor(
    readonly ctx: MatchContext,
    myDeck: string[],
    aiDeck: string[],
    seed: string = randomSeed(),
  ) {
    this.ai = Rng.fromSeed(`${seed}:ai`);
    const { state, events } = createMatch(ctx, {
      seed,
      players: [
        { id: 'me', deck: myDeck },
        { id: 'ai', deck: aiDeck },
      ],
    });
    this.state = state;
    this.initialEvents = events;
  }

  get view(): PlayerView {
    return getPlayerView(this.ctx, this.state, ME);
  }

  /** Décisions de l'IA en début de tour (Hype, Lâcher) : renvoie les événements produits. */
  private aiTurnStart(): MatchEvent[] {
    if (this.state.phase !== 'planning') return [];
    if (aiWantsFold(this.ctx, this.state, AI)) {
      const step = fold(this.ctx, this.state, AI);
      this.state = step.state;
      return step.events;
    }
    if (aiWantsHype(this.ctx, this.state, AI)) {
      const step = declareHype(this.ctx, this.state, AI);
      this.state = step.state;
      return step.events;
    }
    return [];
  }

  async submitTurn(plays: Play[]): Promise<MatchUpdate> {
    const aiPlays = chooseAiPlays(this.ctx, this.state, AI, this.ai);
    const step = resolveTurn(this.ctx, this.state, [{ plays }, aiPlays]);
    this.state = step.state;
    const events = [...step.events, ...this.aiTurnStart()];
    return { events, view: this.view };
  }

  async hype(): Promise<MatchUpdate> {
    const step = declareHype(this.ctx, this.state, ME);
    this.state = step.state;
    return { events: step.events, view: this.view };
  }

  async fold(): Promise<MatchUpdate> {
    const step = fold(this.ctx, this.state, ME);
    this.state = step.state;
    return { events: step.events, view: this.view };
  }
}
