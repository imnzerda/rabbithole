import type { CardDef, GameAction, MatchEvent, MatchResult, PlayerIndex, PlayerView, RulesConfig } from '@rabbithole/engine';

/**
 * Types partagés entre le serveur et le client web : protocole WebSocket `/ws`
 * et réponses de l'API REST. Le serveur valide toujours ce qu'il reçoit.
 */

/** Modes de file ; `daily` : défi du jour (deck imposé contre l'IA, lancé par le message `daily`). */
export type QueueMode = 'casual' | 'ranked' | 'ghost' | 'daily' | 'draft' | 'tournament';

/** Messages client → serveur. */
export type ClientMessage =
  | { t: 'queue'; deckId: string; mode: QueueMode }
  | { t: 'cancel' }
  | { t: 'action'; action: GameAction }
  | { t: 'resume' }
  | { t: 'daily' }
  /** Partie avec le deck du draft en cours (adversaire en file draft, sinon fantôme). */
  | { t: 'draft' }
  /** Match du tour en cours du tournoi (attend l'adversaire ; pas de fantôme). */
  | { t: 'tournament' };

/** Cosmétiques d'un joueur visibles en partie : variante affichée par carte, titre actif. */
export interface PlayerCosmetics {
  variants: Record<string, string>;
  title: Record<string, string> | null;
}

export interface OpponentInfo {
  name: string;
  /** Adversaire fantôme : deck enregistré d'un vrai joueur, joué par l'IA. */
  ghost: boolean;
  leader: string;
}

/** Messages serveur → client. `deadline` : fin du minuteur de la décision en cours (ms epoch), ou null. */
export type ServerMessage =
  | { t: 'hello'; user: { id: string; displayName: string } }
  | { t: 'queued'; mode: QueueMode; ghostInMs: number | null }
  | { t: 'cancelled' }
  /** `contentVersion` : version du catalogue de la partie (le client recharge s'il n'a pas la même). */
  | { t: 'match_start'; matchId: string; you: PlayerIndex; opponent: OpponentInfo; contentVersion: string; cosmetics: [PlayerCosmetics, PlayerCosmetics] }
  | { t: 'step'; matchId: string; events: MatchEvent[]; view: PlayerView; deadline: number | null }
  /** `reward` : pièces gagnées (plafonnées par jour) ; null pour un spectateur ou une reprise. */
  | { t: 'match_end'; matchId: string; result: MatchResult; reward: number | null; ranked: RankedResultDto | null }
  | { t: 'error'; code: string; message: string };

/** Catalogue publié : définitions des cartes, règles, et cartes à collectionner (Leaders compris). */
export interface CatalogDto {
  version: string;
  rules: RulesConfig;
  cards: CardDef[];
  collectible: string[];
}

/** Réglages publics du formulaire d'inscription. */
export interface AuthConfigDto {
  /** Clé de site Cloudflare Turnstile ; `null` : captcha désactivé (développement). */
  turnstileSiteKey: string | null;
  smsMode: 'off' | 'risky' | 'always';
}

/** Réponse à l'inscription : compte créé, ou vérification par SMS demandée. */
export type SignupResponse = { user: PublicUser } | { pendingId: string; verify: 'phone' };

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  country: string;
  locale: string;
  /** Leader de départ choisi (null tant que le joueur ne l'a pas choisi). */
  starterLeader: string | null;
  /** `admin` : accès à l'outil d'administration. */
  role: 'player' | 'admin';
  /** Contenu sensible affiché (sinon masqué : affichage seulement). */
  showSensitive: boolean;
  createdAt: string;
}

export interface WalletDto {
  coins: number;
  gems: number;
  freeBoosters: number;
  /** Boosters à aperçu offerts (pass). */
  previewBoosters: number;
}

export interface BoosterTypeDto {
  type: string;
  name: Record<string, string>;
  price: number;
  size: number;
  refreshHours: number;
  /** Probabilités affichées, en %, par rareté. */
  odds: Record<string, number>;
  /** Aperçu exact du prochain booster acheté. */
  preview: { cardIds: string[]; refreshAt: string };
}

export interface BoostersResponse {
  types: BoosterTypeDto[];
  wallet: WalletDto;
  economy: {
    recycle: Record<string, number>;
    craft: Record<string, number>;
    keepCopies: number;
    /** Doublons demandés par un trade-up : tirage libre, ou catégorie choisie. */
    tradeUp: { count: number; targetedCount: number };
  };
}

/** Trade-up (section 6.4) : cartes possibles, toutes équiprobables, affichées avant l'échange. */
export interface TradeUpOfferDto {
  rarity: string;
  outputRarity: string;
  category: string | null;
  required: number;
  pool: string[];
  /** Probabilité de chaque carte, en %. */
  chance: number;
  /** Vrai si le tirage se limite aux cartes pas encore possédées. */
  unownedOnly: boolean;
}

export interface DeckDto {
  id: string;
  name: string;
  leaderId: string;
  cardIds: string[];
  updatedAt: string;
}

export interface ReplayPlayer {
  name: string;
  leader: string;
  deck: string[];
  ghost: boolean;
}

/** Tout ce qu'il faut pour rejouer une partie à l'identique avec le moteur. */
export interface ReplayData {
  id: string;
  /** Place du joueur qui demande le replay. */
  you: PlayerIndex;
  mode: QueueMode;
  contentVersion: string;
  seed: string;
  players: [ReplayPlayer, ReplayPlayer];
  actions: { player: PlayerIndex; action: GameAction }[];
  /** Cartes en tendance pendant la partie (à rejouer à l'identique). */
  trending: string[];
  result: MatchResult;
  createdAt: string;
}

export interface MatchSummary {
  id: string;
  mode: QueueMode;
  you: PlayerIndex;
  opponent: string;
  ghost: boolean;
  result: MatchResult;
  createdAt: string;
}

// --- Amis et échanges (section 6.5) ---

export interface FriendDto {
  id: string;
  name: string;
  since: string | null;
}

export interface FriendsDto {
  /** Code à donner pour être ajouté (les pseudos ne sont pas uniques). */
  code: string;
  friends: FriendDto[];
  incoming: FriendDto[];
  outgoing: FriendDto[];
}

export interface TradeDto {
  id: string;
  fromUser: { id: string; name: string };
  toUser: { id: string; name: string };
  /** Cartes données par l'auteur de la proposition (vide pour une demande de don). */
  offered: { cardId: string; quantity: number }[];
  /** Cartes demandées à son ami (vide pour un don). */
  requested: { cardId: string; quantity: number }[];
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
}

// --- Boutique en argent réel (sections 6.6 et 14) ---

export interface OfferDto {
  id: string;
  name: Record<string, string>;
  gems: number;
  /** Unité mineure de la devise. */
  amount: number;
  currency: string;
}

export interface PurchaseDto {
  id: string;
  productId: string;
  name: Record<string, string>;
  gems: number;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'cancelled' | 'refunded' | 'chargeback' | 'mismatch';
  createdAt: string;
}

export interface ShopDto {
  /** Faux si aucun prestataire de paiement n'est branché (boutique fermée). */
  enabled: boolean;
  offers: OfferDto[];
  currency: string;
  /** Plafond de dépense mensuel choisi par le joueur (unité mineure), ou null. */
  spendCap: number | null;
  monthSpent: number;
}

/** Notification au joueur. `card_retired` : { cardId, name, rarity, quantity, coins }. */
export interface NoticeDto {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

/** Mission quotidienne ou hebdomadaire (section 13). `category` : pour les missions « jouer des cartes d'une catégorie ». */
export interface MissionDto {
  id: string;
  kind: 'play' | 'win' | 'play_cards' | 'play_category' | 'open_booster' | 'trade_up' | 'trade' | 'craft';
  category: string | null;
  target: number;
  progress: number;
  coins: number;
  xp: number;
  claimed: boolean;
}

export interface MissionsDto {
  daily: { endsAt: string; missions: MissionDto[] };
  weekly: { endsAt: string; missions: MissionDto[] };
}

// --- Pass saisonnier et cosmétiques (section 6.6) ---

export type PassTrack = 'free' | 'premium' | 'deluxe';

/** Récompense d'un niveau du pass. Les pistes payantes ne donnent que des cosmétiques et des boosters à aperçu. */
export type PassReward =
  | { type: 'coins'; amount: number }
  | { type: 'free_booster'; count: number }
  | { type: 'preview_booster'; count: number }
  | { type: 'title'; id: string; name: Record<string, string> }
  | { type: 'variant'; cardId: string; variant: string };

export interface PassTierDto {
  tier: number;
  free: PassReward | null;
  premium: PassReward | null;
  deluxe: PassReward | null;
}

export interface PassDto {
  season: number;
  startsAt: string;
  endsAt: string;
  xp: number;
  level: number;
  xpPerTier: number;
  track: PassTrack;
  /** Niveaux déjà réclamés, par piste. */
  claimed: Record<PassTrack, number[]>;
  tiers: PassTierDto[];
}

/** Cosmétiques possédés : variantes de cartes (une affichée par carte) et titres. */
export interface CosmeticsDto {
  variants: { cardId: string; variant: string; equipped: boolean }[];
  titles: { id: string; name: Record<string, string> }[];
  activeTitle: string | null;
}

// --- Classé (section 7) ---

/** Évolution des points de classement à la fin d'une partie classée. */
export interface RankedResultDto {
  before: number;
  after: number;
  delta: number;
  rankBefore: string;
  rank: string;
}

export interface RankedDto {
  season: string;
  endsAt: string;
  points: number;
  bestPoints: number;
  rank: string;
  /** Rang suivant et son seuil, ou null au rang maximal. */
  next: { rank: string; min: number } | null;
  rankMin: number;
  wins: number;
  losses: number;
  draws: number;
  /** Positions dans les classements (null sans partie classée cette saison). */
  position: number | null;
  countryPosition: number | null;
  country: string;
  /** Seuils de tous les rangs, pour l'affichage. */
  ranks: { id: string; min: number }[];
}

export interface LeaderboardEntryDto {
  position: number;
  name: string;
  title: Record<string, string> | null;
  country: string;
  points: number;
  rank: string;
  you: boolean;
}

// --- Succès et progression de collection (section 13) ---

export interface AchievementDto {
  id: string;
  metric: string;
  /** Succès « Spécialiste » : catégorie dont il faut posséder toutes les cartes. */
  category: string | null;
  target: number;
  progress: number;
  coins: number;
  title: Record<string, string> | null;
  unlocked: boolean;
  claimed: boolean;
}

export interface AchievementsDto {
  collection: {
    points: number;
    level: number;
    pointsPerLevel: number;
    /** Niveaux atteints et pas encore réclamés. */
    claimable: number;
    reward: { coins: number; freeBoosters: number };
  };
  achievements: AchievementDto[];
}

// --- Tendance du jour (section 8) ---

export interface TrendingCardDto {
  cardId: string;
  /** Vues de la veille / moyenne des 30 jours précédents. */
  score: number;
  views: number;
  average: number;
  /** Raison d'exclusion (admin uniquement) : watchlist, recent_death, admin. */
  excluded: string | null;
}

// --- Défi du jour (section 7) ---

export interface DailyResultDto {
  won: boolean;
  turns: number;
  livesLeft: number;
  livesTaken: number;
  score: number;
  /** Vies de départ des deux Leaders, pour le partage. */
  lives: number;
  opponentLives: number;
}

/** Un match du tableau : joueurs (`null` = exemption), vainqueur et manière (en direct, simulé, exemption). */
export interface TournamentSlotDto {
  slot: number;
  a: { name: string; leader: string; you: boolean } | null;
  b: { name: string; leader: string; you: boolean } | null;
  winner: 'a' | 'b' | null;
  how: 'bye' | 'played' | 'simulated' | null;
}

export interface TournamentDto {
  id: string;
  startDate: string;
  startsAt: string;
  status: 'registering' | 'running' | 'done' | 'cancelled';
  round: number;
  rounds: number;
  /** Échéance du tour en cours : un match non joué est alors tranché par simulation. */
  roundEndsAt: string | null;
  players: number;
  registered: { leader: string; cards: number } | null;
  /** Tableau, tour par tour. */
  bracket: TournamentSlotDto[][];
  myMatch: { round: number; opponent: string; opponentLeader: string; live: boolean } | null;
  /** Classement final (1 = champion, 2 = finaliste, 4 = demi-finaliste…) et récompense. */
  result: { top: number; reward: DraftRewardDto } | null;
}

export interface TournamentsDto {
  /** Tournoi ouvert aux inscriptions. */
  next: TournamentDto;
  /** Tournoi en cours, sinon le dernier terminé. */
  current: TournamentDto | null;
  roundHours: number;
  rewards: { top: number; coins: number; freeBoosters: number }[];
}

export interface DraftRewardDto {
  coins: number;
  freeBoosters: number;
}

/** Draft du week-end : Leader choisi parmi `leaderChoices`, puis une carte par proposition (`offer`). */
export interface DraftRunDto {
  id: string;
  status: 'picking' | 'playing' | 'done';
  entry: 'free' | 'coins';
  leader: string | null;
  leaderChoices: string[];
  offer: string[];
  picks: string[];
  deckSize: number;
  wins: number;
  losses: number;
  reward: DraftRewardDto | null;
}

export interface DraftDto {
  open: boolean;
  /** Prochaine ouverture (ISO), quand le draft est fermé. */
  opensAt: string | null;
  week: string;
  entryCoins: number;
  freeLeft: number;
  maxWins: number;
  maxLosses: number;
  /** Récompense selon le nombre de victoires (indice = victoires). */
  rewards: DraftRewardDto[];
  /** Draft en cours, sinon le dernier de la semaine. */
  run: DraftRunDto | null;
}

export interface DailyDto {
  date: string;
  deck: { name: Record<string, string>; leader: string; cards: string[] };
  opponent: { name: Record<string, string>; leader: string };
  result: DailyResultDto | null;
  leaderboard: { position: number; name: string; score: number; won: boolean; turns: number; you: boolean }[];
  position: number | null;
  players: number;
}
