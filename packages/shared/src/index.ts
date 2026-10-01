import type { GameAction, MatchEvent, MatchResult, PlayerIndex, PlayerView } from '@rabbithole/engine';

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
  | { t: 'match_start'; matchId: string; you: PlayerIndex; opponent: OpponentInfo }
  | { t: 'step'; matchId: string; events: MatchEvent[]; view: PlayerView; deadline: number | null }
  | { t: 'match_end'; matchId: string; result: MatchResult }
  | { t: 'error'; code: string; message: string };

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  country: string;
  locale: string;
  createdAt: string;
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
