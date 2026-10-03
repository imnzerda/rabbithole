import type { CardDef, GameAction, MatchEvent, MatchResult, PlayerIndex, PlayerView, RulesConfig } from '@rabbithole/engine';

/**
 * Types partagés entre le serveur et le client web : protocole WebSocket `/ws`
 * et réponses de l'API REST. Le serveur valide toujours ce qu'il reçoit.
 */

export type QueueMode = 'casual' | 'ranked' | 'ghost';

/** Messages client → serveur. */
export type ClientMessage =
  | { t: 'queue'; deckId: string; mode: QueueMode }
  | { t: 'cancel' }
  | { t: 'action'; action: GameAction }
  | { t: 'resume' };

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
  | { t: 'match_start'; matchId: string; you: PlayerIndex; opponent: OpponentInfo; contentVersion: string }
  | { t: 'step'; matchId: string; events: MatchEvent[]; view: PlayerView; deadline: number | null }
  /** `reward` : pièces gagnées (plafonnées par jour) ; null pour un spectateur ou une reprise. */
  | { t: 'match_end'; matchId: string; result: MatchResult; reward: number | null }
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
