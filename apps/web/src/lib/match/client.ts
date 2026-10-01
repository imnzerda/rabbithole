import type { MatchContext, MatchEvent, Play, PlayerView } from '@rabbithole/engine';

/** Résultat d'une action : événements à animer + vue finale faisant foi. */
export interface MatchUpdate {
  events: MatchEvent[];
  view: PlayerView;
}

/**
 * Contrat entre l'UI et la partie. L'UI ne voit que des `PlayerView` et des événements :
 * jamais l'état complet ni la main adverse.
 * - Phase 2 : `LocalMatch` (moteur + IA dans le navigateur).
 * - Phase 3 : implémentation WebSocket, le serveur fait foi.
 */
export interface MatchClient {
  /** Catalogue public (définitions des cartes et terrains, règles) pour l'affichage. */
  readonly ctx: MatchContext;
  readonly view: PlayerView;
  /** Événements de mise en place (pioche initiale, premier terrain). */
  readonly initialEvents: MatchEvent[];
  submitTurn(plays: Play[]): Promise<MatchUpdate>;
  hype(): Promise<MatchUpdate>;
  fold(): Promise<MatchUpdate>;
}
