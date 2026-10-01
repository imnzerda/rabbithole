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

export const CARD_TYPES = ['leader', 'character', 'event'] as const;
export type CardType = (typeof CARD_TYPES)[number];

/**
 * Mots-clés (inspirés du TCG One Piece, noms « culture internet ») :
 * - elan (Rush), bloqueur (Blocker), viral (Double attaque), ratio (Bannissement)
 * - clickbait (+2 en attaque), croissance (+1 à chaque fin de tour)
 * - rickroll, cancel, seduction, shitpost : effets « Jouée » standard
 * - tendance : bonus quotidien automatique (jamais imprimé sur une carte)
 */
export const KEYWORDS = [
  'elan',
  'bloqueur',
  'viral',
  'ratio',
  'clickbait',
  'croissance',
  'rickroll',
  'cancel',
  'seduction',
  'shitpost',
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
 * Moments de déclenchement :
 * - on_play [Jouée], on_attack [Attaque], on_ko [KO], on_trigger [Déclencheur] (carte Vie révélée)
 * - continuous [Continu], activate_main [Activation : principale] (1 fois par tour)
 * - end_of_turn [Fin de ton tour]
 * - main / counter : effet d'une carte Événement jouée en phase principale / pendant un contre
 */
export const TRIGGERS = [
  'on_play',
  'on_attack',
  'on_ko',
  'on_trigger',
  'continuous',
  'activate_main',
  'end_of_turn',
  'main',
  'counter',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

/**
 * Cibles résolues automatiquement (pas de choix manuel : le jeu reste simple).
 * Égalité « plus fort / plus faible » → la carte posée en premier.
 */
export const TARGET_SELECTORS = [
  'self',
  'my_leader',
  'enemy_leader',
  'allies',
  'enemies',
  'all_mine',
  'strongest_enemy',
  'weakest_enemy',
  'random_enemy',
  'strongest_ally',
  'weakest_ally',
  'battle_target',
  'attacker',
] as const;
export type TargetSelector = (typeof TARGET_SELECTORS)[number];

/** Sélecteurs utilisables par un effet continu (déterministes, sans dépendance à la puissance). */
export const STATIC_SELECTORS: readonly TargetSelector[] = ['self', 'my_leader', 'enemy_leader', 'allies', 'enemies', 'all_mine'];

/** `self` = le contrôleur de la source, `enemy` = son adversaire. */
export type Side = 'self' | 'enemy';

export interface CardFilter {
  categories?: CategoryId[];
  keywords?: KeywordId[];
  cardIds?: string[];
  minCost?: number;
  maxCost?: number;
  /** Puissance de base (imprimée + modifications permanentes), pour éviter toute circularité. */
  maxPower?: number;
  rested?: boolean;
}

export const COUNT_ZONES = ['allies', 'enemies', 'hand', 'enemy_hand', 'life', 'enemy_life', 'trash'] as const;
export type CountZone = (typeof COUNT_ZONES)[number];

export interface CountAmount {
  type: 'count';
  zone: CountZone;
  filter?: CardFilter;
  multiplier?: number;
  base?: number;
}
export type Amount = number | CountAmount;

/** Durée d'un bonus de puissance. */
export type Duration = 'turn' | 'battle' | 'permanent';

export type Condition =
  | { type: 'count'; zone: CountZone; filter?: CardFilter; min?: number; max?: number }
  | { type: 'my_turn' }
  | { type: 'opponent_turn' }
  | { type: 'buzz_attached'; min: number }
  | { type: 'attacking_leader' }
  | { type: 'and'; conditions: Condition[] }
  | { type: 'or'; conditions: Condition[] }
  | { type: 'not'; condition: Condition };

interface Targeted {
  target: TargetSelector;
  filter?: CardFilter;
}

export type Action =
  | ({ type: 'add_power'; amount: Amount; duration?: Duration } & Targeted)
  | ({ type: 'ko' } & Targeted)
  | ({ type: 'rest' } & Targeted)
  | ({ type: 'refresh' } & Targeted)
  | ({ type: 'bounce' } & Targeted)
  | ({ type: 'steal' } & Targeted)
  | ({ type: 'cancel_effects' } & Targeted)
  | { type: 'draw'; amount: number; side?: Side }
  | { type: 'discard'; amount: number; side?: Side; pick?: 'random' | 'highest_cost' | 'lowest_cost' }
  | { type: 'add_card_to_hand'; cards: string[]; pick?: 'all' | 'random'; count?: number; side?: Side }
  | { type: 'add_buzz'; amount: number }
  | { type: 'random_of'; options: Action[]; weights?: number[] };

export type ActionType = Action['type'];

export interface Effect {
  trigger: Trigger;
  condition?: Condition;
  action: Action;
  /** Coût en Buzz actif à payer pour une activation (`activate_main`). */
  buzzCost?: number;
}

// ---------------------------------------------------------------------------
// Définitions de contenu
// ---------------------------------------------------------------------------

export interface CardDef {
  id: string;
  wikidataId?: string;
  type: CardType;
  name: LocalizedText;
  /** 1 ou 2. Pour un Leader : les catégories autorisées dans son deck. */
  categories: CategoryId[];
  /** Coût en Buzz (0 pour un Leader). */
  cost: number;
  /** Puissance (Leader, Personnage). 0 pour un Événement. */
  power: number;
  /** Valeur de Contre quand on défausse ce Personnage pendant une attaque adverse (0, 1 ou 2). */
  counter?: number;
  /** Vies (Leader uniquement). */
  life?: number;
  rarity: Rarity;
  series: string;
  country?: string;
  keywords: KeywordId[];
  effects: Effect[];
  flavor?: LocalizedText;
  /** `adult` : filtrage par pays ; `politicallySensitive` : idem ; `sensitive` : masqué si le joueur coupe le contenu sensible. */
  flags?: { adult?: boolean; politicallySensitive?: boolean; sensitive?: boolean };
  image?: { assetId: string | null; fallback: boolean };
}

// ---------------------------------------------------------------------------
// État de partie (JSON pur)
// ---------------------------------------------------------------------------

export type CardZone = 'deck' | 'hand' | 'life' | 'leader' | 'field' | 'trash';

export interface CardInstance {
  uid: string;
  defId: string;
  owner: PlayerIndex;
  controller: PlayerIndex;
  zone: CardZone;
  rested: boolean;
  playedTurn: number | null;
  /** Buzz attachés (+1 puissance chacun pendant le tour de son contrôleur). */
  buzz: number;
  permMod: number;
  turnMod: number;
  battleMod: number;
  effectsCancelled: boolean;
  /** Dernier tour où son effet « Activation : principale » a servi. */
  activatedTurn: number | null;
  /** Créée en cours de partie (jeton). */
  token: boolean;
}

export interface PlayerState {
  id: string;
  leader: string;
  deck: string[];
  hand: string[];
  /** Cartes Vie, face cachée. Index 0 = dessus de la pile. */
  life: string[];
  /** Personnages en jeu, dans l'ordre de pose. */
  characters: string[];
  trash: string[];
  /** Buzz restant dans la réserve (pas encore gagné). */
  buzzDeck: number;
  buzzActive: number;
  buzzRested: number;
  hypeDeclared: boolean;
}

export type Phase = 'mulligan' | 'main' | 'block' | 'counter' | 'trigger' | 'ended';

export interface Battle {
  attacker: string;
  attackerPlayer: PlayerIndex;
  /** Cible actuelle (Leader adverse, Personnage épuisé, ou Bloqueur). */
  target: string;
  /** Cible d'origine, avant un éventuel blocage. */
  declaredTarget: string;
  blocked: boolean;
}

export interface PendingDamage {
  player: PlayerIndex;
  remaining: number;
  banish: boolean;
  /** Carte Vie révélée qui attend la décision Déclencheur. */
  trigger: string | null;
}

export type MatchEndReason = 'life' | 'deck_out' | 'turn_limit' | 'fold' | 'draw';

export interface MatchResult {
  winner: PlayerIndex | null;
  reason: MatchEndReason;
  /** Points de rang en jeu (Hype). */
  stake: number;
  life: [number, number];
  turns: number;
}

export interface MatchState {
  version: 2;
  seed: string;
  rng: RngState;
  /** Tour global : 1 = premier tour du premier joueur, 2 = premier tour du second… */
  turn: number;
  first: PlayerIndex;
  active: PlayerIndex;
  phase: Phase;
  /** Joueurs qui doivent encore décider de leur main de départ, dans l'ordre. */
  mulliganPending: PlayerIndex[];
  players: [PlayerState, PlayerState];
  cards: Record<string, CardInstance>;
  nextUid: number;
  battle: Battle | null;
  damage: PendingDamage | null;
  stake: number;
  trending: string[];
  result: MatchResult | null;
}

// ---------------------------------------------------------------------------
// Entrées / sorties
// ---------------------------------------------------------------------------

export interface PlayerSetup {
  id: string;
  leader: string;
  deck: string[];
}

export interface MatchSetup {
  /** Seed fournie par le serveur (RNG crypto), enregistrée pour l'audit. */
  seed: string;
  players: [PlayerSetup, PlayerSetup];
  /** Premier joueur imposé ; sinon tiré au sort. */
  first?: PlayerIndex;
  trendingCardIds?: string[];
  /** Défaut : true. `false` pour les tests et les défis à ordre fixe. */
  shuffleDecks?: boolean;
  /** Défaut : false. `true` pour sauter la phase de mulligan (tests, IA rapide). */
  skipMulligan?: boolean;
}

/** Actions d'un joueur. Toute action est validée par le moteur (le serveur fait foi). */
export type GameAction =
  | { type: 'mulligan'; redraw: boolean }
  | { type: 'play'; uid: string }
  | { type: 'attach'; target: string; amount?: number }
  | { type: 'attack'; attacker: string; target: string }
  | { type: 'activate'; uid: string }
  | { type: 'end_turn' }
  | { type: 'block'; blocker: string | null }
  | { type: 'counter'; uids: string[] }
  | { type: 'trigger'; activate: boolean }
  | { type: 'hype' }
  | { type: 'fold' };

export type MatchEvent =
  | { type: 'mulligan'; player: PlayerIndex; redraw: boolean }
  | { type: 'life_set'; player: PlayerIndex; count: number }
  | { type: 'turn_started'; turn: number; player: PlayerIndex }
  | { type: 'refreshed'; player: PlayerIndex }
  | { type: 'buzz_gained'; player: PlayerIndex; amount: number; rested: boolean }
  | { type: 'card_drawn'; player: PlayerIndex; uid: string }
  | { type: 'draw_failed'; player: PlayerIndex }
  | { type: 'card_played'; player: PlayerIndex; uid: string; defId: string; cardType: CardType }
  | { type: 'buzz_spent'; player: PlayerIndex; amount: number }
  | { type: 'buzz_attached'; player: PlayerIndex; target: string; amount: number }
  | { type: 'effect_activated'; uid: string; trigger: Trigger }
  | { type: 'keyword_triggered'; uid: string; keyword: KeywordId; targets: string[] }
  | { type: 'power_changed'; uid: string; delta: number; duration: Duration; power: number; source: string | null }
  | { type: 'attack_declared'; attacker: string; target: string; player: PlayerIndex }
  | { type: 'blocked'; blocker: string; player: PlayerIndex }
  | { type: 'counter_played'; player: PlayerIndex; uid: string; defId: string; value: number }
  | { type: 'battle_resolved'; attacker: string; target: string; attackerPower: number; defenderPower: number; hit: boolean }
  | { type: 'life_lost'; player: PlayerIndex; uid: string; to: 'hand' | 'trash'; remaining: number }
  | { type: 'trigger_revealed'; player: PlayerIndex; uid: string; defId: string }
  | { type: 'trigger_resolved'; player: PlayerIndex; uid: string; activated: boolean }
  | { type: 'card_ko'; uid: string; source: string | null }
  | { type: 'card_bounced'; uid: string; source: string | null }
  | { type: 'card_stolen'; uid: string; from: PlayerIndex; to: PlayerIndex; source: string | null }
  | { type: 'card_rested'; uid: string; source: string | null }
  | { type: 'card_refreshed'; uid: string; source: string | null }
  | { type: 'card_discarded'; player: PlayerIndex; uid: string; source: string | null }
  | { type: 'card_created'; player: PlayerIndex; uid: string; defId: string; source: string | null }
  | { type: 'effects_cancelled'; uid: string; source: string | null }
  | { type: 'random_choice'; source: string | null; index: number; of: number }
  | { type: 'hype_declared'; player: PlayerIndex }
  | { type: 'stake_changed'; stake: number }
  | { type: 'turn_ended'; turn: number; player: PlayerIndex }
  | { type: 'match_ended'; result: MatchResult };

export interface StepResult {
  state: MatchState;
  events: MatchEvent[];
}
