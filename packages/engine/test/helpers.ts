import {
  computePowers,
  createContext,
  createMatch,
  declareHype,
  fold,
  resolveTurn,
  Rng,
  terrainPowers,
  validatePlays,
  type CardDef,
  type CardInstance,
  type MatchContext,
  type MatchEvent,
  type MatchState,
  type PlayerIndex,
  type RulesOverride,
  type TurnSubmission,
} from '../src/index.js';
import { FILLERS, TERRAINS } from './fixtures.js';

/** Mana illimité, 3 terrains révélés dès le tour 1, main de départ pleine. */
export const SANDBOX_RULES: RulesOverride = {
  manaByTurn: [10, 10, 10, 10, 10, 10],
  terrainRevealTurns: [1, 1, 1],
  startingHand: 6,
};

export type PlaySpec = [defId: string, terrain: number];

export class Game {
  events: MatchEvent[];
  allEvents: MatchEvent[];

  constructor(
    readonly ctx: MatchContext,
    public state: MatchState,
    events: MatchEvent[],
  ) {
    this.events = events;
    this.allEvents = [...events];
  }

  private apply(step: { state: MatchState; events: MatchEvent[] }): this {
    this.state = step.state;
    this.events = step.events;
    this.allEvents.push(...step.events);
    return this;
  }

  handUid(player: PlayerIndex, defId: string): string {
    const uid = this.state.players[player].hand.find((u) => this.state.cards[u]!.defId === defId);
    if (!uid) throw new Error(`${defId} absent de la main du joueur ${player}`);
    return uid;
  }

  submission(player: PlayerIndex, plays: PlaySpec[]): TurnSubmission {
    return { plays: plays.map(([defId, terrain]) => ({ uid: this.handUid(player, defId), terrain })) };
  }

  play(a: PlaySpec[], b: PlaySpec[] = []): this {
    return this.apply(resolveTurn(this.ctx, this.state, [this.submission(0, a), this.submission(1, b)]));
  }

  pass(turns = 1): this {
    for (let i = 0; i < turns; i++) this.play([], []);
    return this;
  }

  /** Passe jusqu'à la fin de la partie. */
  finish(): this {
    while (this.state.phase === 'planning') this.pass();
    return this;
  }

  hype(player: PlayerIndex): this {
    return this.apply(declareHype(this.ctx, this.state, player));
  }

  fold(player: PlayerIndex): this {
    return this.apply(fold(this.ctx, this.state, player));
  }

  /** Instances d'une définition, quelle que soit la zone (originales d'abord). */
  instances(defId: string, controller?: PlayerIndex): CardInstance[] {
    return Object.values(this.state.cards)
      .filter((c) => c.defId === defId && (controller === undefined || c.controller === controller))
      .sort((x, y) => Number(x.token) - Number(y.token));
  }

  card(defId: string, controller?: PlayerIndex): CardInstance {
    const c = this.instances(defId, controller)[0];
    if (!c) throw new Error(`Aucune instance de ${defId}`);
    return c;
  }

  power(defId: string, controller?: PlayerIndex): number | undefined {
    return computePowers(this.ctx, this.state)[this.card(defId, controller).uid];
  }

  terrainPowers(): [number, number][] {
    return terrainPowers(this.ctx, this.state);
  }

  eventsOf<T extends MatchEvent['type']>(type: T): Extract<MatchEvent, { type: T }>[] {
    return this.allEvents.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type);
  }
}

export interface SandboxOptions {
  cards: CardDef[];
  a: string[];
  b: string[];
  terrains?: string[];
  rules?: RulesOverride;
  seed?: string;
  trending?: string[];
}

/** Partie de test : decks dans l'ordre donné (non mélangés), complétés par des cartes de remplissage. */
export function sandbox(opts: SandboxOptions): Game {
  const ctx = createContext({
    cards: [...opts.cards, ...FILLERS],
    terrains: TERRAINS,
    rules: opts.rules ?? SANDBOX_RULES,
  });
  const pad = (ids: string[]) => [...ids, ...FILLERS.map((f) => f.id)].slice(0, ctx.rules.deckSize);
  const { state, events } = createMatch(ctx, {
    seed: opts.seed ?? 'test-seed',
    players: [
      { id: 'A', deck: pad(opts.a) },
      { id: 'B', deck: pad(opts.b) },
    ],
    terrainIds: opts.terrains ?? ['neutral_1', 'neutral_2', 'neutral_3'],
    shuffleDecks: false,
    trendingCardIds: opts.trending,
  });
  return new Game(ctx, state, events);
}

/** IA de test aléatoire (seedée) : pose des cartes abordables au hasard, déclare parfois Hype. */
export function randomSubmission(ctx: MatchContext, s: MatchState, p: PlayerIndex, rng: Rng): TurnSubmission {
  const hand = rng.shuffle([...s.players[p].hand]);
  const plays: TurnSubmission['plays'] = [];
  for (const uid of hand) {
    if (rng.int(3) === 0) continue;
    const candidate = { uid, terrain: rng.int(s.terrains.length) };
    if (validatePlays(ctx, s, p, { plays: [...plays, candidate] }).length === 0) plays.push(candidate);
  }
  return { plays };
}
