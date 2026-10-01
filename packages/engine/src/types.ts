import type { RngState } from './rng.js';

// ---------------------------------------------------------------------------
// Constantes de contenu
// ---------------------------------------------------------------------------

export const CATEGORIES = [
  'nuits_exces',
  'crimes_scandales',
  'mysteres',
  'guerre_pouvoir',
  'sport',
  'musique',
  'series_cinema',
  'internet',
  'science',
  'exploration',
] as const;
export type CategoryId = (typeof CATEGORIES)[number];

export const RARITIES = ['basique', 'tendance', 'viral', 'iconique', 'goat'] as const;
export type Rarity = (typeof RARITIES)[number];

export const KEYWORDS = [
  'viral',
  'ratio',
  'cancel',
  'clickbait',
  'rickroll',
  'shitpost',
  'seduction',
  'elan',
  'croissance',
  'tendance',
] as const;
export type KeywordId = (typeof KEYWORDS)[number];

export type LocalizedText = Record<string, string>;

export type PlayerIndex = 0 | 1;
export const PLAYERS: readonly PlayerIndex[] = [0, 1];
export const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

// ---------------------------------------------------------------------------
// DSL d'effets
// ---------------------------------------------------------------------------

/**
 * `on_reveal`, `continuous` et `end_of_game` sont les trois types du cahier des charges.
 * `start_of_turn` et `end_of_turn` sont des extensions (base de Croissance)
 * traitées comme des effets continus : `Cancel` les désactive.
 */
export const TRIGGERS = ['on_reveal', 'continuous', 'end_of_game', 'start_of_turn', 'end_of_turn'] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const TARGET_SELECTORS = [
  'self',
  'allies_here',
  'enemies_here',
  'opposite_card',
  'random_enemy_here',
  'all_here',
  'strongest_enemy_here',
  'weakest_enemy_here',
  'hand',
  'deck',
] as const;
export type TargetSelector = (typeof TARGET_SELECTORS)[number];

/** Sélecteurs utilisables par un effet continu (déterministes, sans dépendance à la puissance). */
export const STATIC_BOARD_SELECTORS: readonly TargetSelector[] = [
  'self',
  'allies_here',
  'enemies_here',
  'all_here',
  'opposite_card',
];

/** `self` = le contrôleur de la source, `enemy` = son adversaire. */
export type Side = 'self' | 'enemy';

/** Filtre sur les cartes ciblées ou comptées. Tous les critères présents doivent correspondre. */
export interface CardFilter {
  /** La carte a au moins une de ces catégories. */
  categories?: CategoryId[];
  countries?: string[];
  /** La carte a au moins un de ces mots-clés (`tendance` inclut les cartes en tendance du jour). */
  keywords?: KeywordId[];
  rarities?: Rarity[];
  cardIds?: string[];
  minCost?: number;
  maxCost?: number;
  /** Posée pendant le tour en cours. */
  playedThisTurn?: boolean;
}

export const COUNT_ZONES = [
  'allies_here',
  'enemies_here',
  'all_here',
  'allies_everywhere',
  'enemies_everywhere',
  'hand',
] as const;
export type CountZone = (typeof COUNT_ZONES)[number];

/** Montant dynamique : `base + multiplier × nombre de cartes de la zone`. La source n'est jamais comptée. */
export interface CountAmount {
  type: 'count';
  zone: CountZone;
  filter?: CardFilter;
  multiplier?: number;
  base?: number;
}
export type Amount = number | CountAmount;

export type Condition =
  | { type: 'count'; zone: CountZone; filter?: CardFilter; min?: number; max?: number }
  | { type: 'terrain_has_category'; category: CategoryId; min: number; side?: 'allies' | 'enemies' | 'any' }
  | { type: 'turn'; min?: number; max?: number }
  | { type: 'played_on_turn'; min?: number; max?: number }
  | { type: 'hand_size'; side?: Side; min?: number; max?: number }
  | { type: 'terrain_is'; terrainIds: string[] }
  | { type: 'and'; conditions: Condition[] }
  | { type: 'or'; conditions: Condition[] }
  | { type: 'not'; condition: Condition };

export type MoveDestination = 'random_other' | 'left' | 'right';

interface Targeted {
  target: TargetSelector;
  filter?: CardFilter;
  /** Pour `hand` / `deck` : main ou pioche de qui. Défaut : `self`. */
  side?: Side;
}

export type Action =
  | ({ type: 'add_power'; amount: Amount } & Targeted)
  | ({ type: 'set_power'; amount: Amount } & Targeted)
  | ({ type: 'destroy' } & Targeted)
  | ({ type: 'move'; to: MoveDestination } & Targeted)
  | ({ type: 'copy'; to?: 'here' | 'random_other' | 'hand'; powerDelta?: number } & Targeted)
  | ({ type: 'transform'; into: string[] } & Targeted)
  | ({ type: 'steal' } & Targeted)
  | ({ type: 'hide' } & Targeted)
  | ({ type: 'cancel_effects'; scope?: 'all' | 'continuous' } & Targeted)
  | { type: 'draw'; amount: number; side?: Side }
  | { type: 'discard'; amount: number; side?: Side; pick?: 'random' | 'highest_cost' | 'lowest_cost' }
  | { type: 'add_card_to_hand'; cards: string[]; pick?: 'all' | 'random'; count?: number; side?: Side }
  | { type: 'random_of'; options: Action[]; weights?: number[] };

export type ActionType = Action['type'];

export interface Effect {
  trigger: Trigger;
  condition?: Condition;
  action: Action;
}

// ---------------------------------------------------------------------------
// Définitions de contenu
// ---------------------------------------------------------------------------

export interface CardDef {
  id: string;
  wikidataId?: string;
  name: LocalizedText;
  categories: CategoryId[];
  cost: number;
  power: number;
  rarity: Rarity;
  series: string;
  country?: string;
  keywords: KeywordId[];
  effects: Effect[];
  flavor?: LocalizedText;
  flags?: { adult?: boolean; politicallySensitive?: boolean };
  image?: { assetId: string | null; fallback: boolean };
}

export type TerrainModifier =
  /** Les cartes correspondantes ont +amount (ou -amount) ici. */
  | { type: 'power'; filter?: CardFilter; amount: number }
  /** Les cartes correspondantes coûtent +amount ici (négatif = réduction). */
  | { type: 'cost'; filter?: CardFilter; amount: number }
  /** Chaque carte correspondante donne +amount à ses alliés ici. */
  | { type: 'aura'; filter: CardFilter; amount: number }
  /** Élan se déclenche quel que soit le tour. */
  | { type: 'elan_always' }
  /** Les effets aléatoires se déclenchent deux fois. */
  | { type: 'random_twice' };

export interface TerrainDef {
  id: string;
  name: LocalizedText;
  description?: LocalizedText;
  series?: string;
  favoredCategory?: CategoryId;
  /** Les cartes de ce pays gagnent `rules.countryTerrainBonus` ici. */
  favoredCountry?: string;
  modifiers: TerrainModifier[];
}

// ---------------------------------------------------------------------------
// État de partie (entièrement sérialisable en JSON)
// ---------------------------------------------------------------------------

export type CardZone = 'deck' | 'hand' | 'board' | 'destroyed' | 'discarded';

export interface CardInstance {
  uid: string;
  defId: string;
  owner: PlayerIndex;
  controller: PlayerIndex;
  zone: CardZone;
  terrain: number | null;
  /** Puissance imprimée, ou fixée par `set_power` / `transform`. */
  powerBase: number;
  /** Modifications permanentes cumulées. */
  powerMod: number;
  revealed: boolean;
  playedTurn: number | null;
  /** Carte créée en cours de partie (copie, génération) : ne déclenche pas « à la révélation ». */
  token: boolean;
  effectsCancelled: boolean;
  continuousCancelled: boolean;
  hidden: boolean;
  /** Bonus Clickbait actif jusqu'à la fin de ce tour. */
  clickbaitUntilTurn: number | null;
}

export interface PlayerState {
  id: string;
  deck: string[];
  hand: string[];
  destroyed: string[];
  discarded: string[];
  hypeDeclared: boolean;
}

export interface TerrainState {
  defId: string;
  revealed: boolean;
  /** uids par joueur, dans l'ordre de pose. */
  slots: [string[], string[]];
}

export type MatchEndReason = 'terrains' | 'total_power' | 'draw' | 'fold';

export interface MatchResult {
  winner: PlayerIndex | null;
  reason: MatchEndReason;
  /** Points de rang en jeu (Hype). */
  stake: number;
  terrainPowers: [number, number][];
  controllers: (PlayerIndex | null)[];
  totalPower: [number, number];
}

export interface MatchState {
  version: 1;
  seed: string;
  rng: RngState;
  turn: number;
  phase: 'planning' | 'ended';
  players: [PlayerState, PlayerState];
  terrains: TerrainState[];
  cards: Record<string, CardInstance>;
  nextUid: number;
  revealFirst: PlayerIndex;
  revealFirstReason: 'leader' | 'coin_flip';
  stake: number;
  trending: string[];
  result: MatchResult | null;
}

// ---------------------------------------------------------------------------
// Entrées / sorties
// ---------------------------------------------------------------------------

export interface PlayerSetup {
  id: string;
  deck: string[];
}

export interface MatchSetup {
  /** Seed fournie par le serveur (RNG crypto), enregistrée pour l'audit. */
  seed: string;
  players: [PlayerSetup, PlayerSetup];
  /** Terrains imposés ; sinon tirés au sort dans `terrainPool` (ou tous les terrains du contexte). */
  terrainIds?: string[];
  terrainPool?: string[];
  /** Cartes en Tendance du jour (instantané au lancement de la partie). */
  trendingCardIds?: string[];
  /** Défaut : true. `false` uniquement pour les tests et le défi du jour à ordre fixe. */
  shuffleDecks?: boolean;
}

export interface Play {
  uid: string;
  terrain: number;
}

export interface TurnSubmission {
  plays: Play[];
}

export type MatchEvent =
  | { type: 'turn_started'; turn: number; mana: number }
  | { type: 'reveal_order'; first: PlayerIndex; reason: 'leader' | 'coin_flip' }
  | { type: 'terrain_revealed'; terrain: number; defId: string }
  | { type: 'card_drawn'; player: PlayerIndex; uid: string }
  | { type: 'draw_failed'; player: PlayerIndex; reason: 'deck_empty' | 'hand_full' }
  | { type: 'card_played'; player: PlayerIndex; uid: string; terrain: number }
  /** `power` : puissance effective au moment de l'événement (pour l'animation). */
  | { type: 'card_revealed'; player: PlayerIndex; uid: string; defId: string; terrain: number; power: number }
  | { type: 'keyword_triggered'; uid: string; keyword: KeywordId; targets: string[] }
  | { type: 'power_changed'; uid: string; delta: number; power: number; source: string | null }
  | { type: 'power_set'; uid: string; value: number; power: number; source: string | null }
  | { type: 'card_destroyed'; uid: string; source: string | null }
  | { type: 'card_moved'; uid: string; from: number; to: number; source: string | null }
  | { type: 'card_stolen'; uid: string; from: PlayerIndex; to: PlayerIndex; terrain: number; source: string | null }
  | {
      type: 'card_created';
      uid: string;
      defId: string;
      player: PlayerIndex;
      zone: 'board' | 'hand';
      terrain: number | null;
      power: number;
      source: string | null;
    }
  | { type: 'card_transformed'; uid: string; from: string; to: string; power: number; source: string | null }
  | { type: 'card_discarded'; uid: string; player: PlayerIndex; source: string | null }
  | { type: 'card_hidden'; uid: string; source: string | null }
  | { type: 'effects_cancelled'; uid: string; scope: 'all' | 'continuous'; source: string | null }
  | { type: 'random_choice'; source: string | null; index: number; of: number }
  | { type: 'hype_declared'; player: PlayerIndex }
  | { type: 'stake_changed'; stake: number; reason: 'hype' | 'final_turn' }
  | { type: 'turn_ended'; turn: number }
  | { type: 'match_ended'; result: MatchResult };

export interface StepResult {
  state: MatchState;
  events: MatchEvent[];
}
