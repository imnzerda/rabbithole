import type { GameAction, MatchContext, MatchEvent, PlayerView } from '@rabbithole/engine';

/** Une étape de jeu : les événements à animer, puis la vue qui fait foi. */
export interface MatchStep {
  events: MatchEvent[];
  view: PlayerView;
}

/**
 * Contrat entre l'UI et la partie. L'UI ne voit que des `PlayerView` et des événements :
 * jamais l'état complet, ni la main ou les Vies adverses.
 * - Phase 2 : `LocalMatch` (moteur + IA dans le navigateur).
 * - Phase 3 : implémentation WebSocket, le serveur fait foi.
 */
export interface MatchClient {
  /** Catalogue public (définitions des cartes, règles) pour l'affichage. */
  readonly ctx: MatchContext;
  readonly view: PlayerView;
  /** Étapes de mise en place (pioche, éventuel mulligan et premier tour de l'IA). */
  readonly initialSteps: MatchStep[];
  /** Joue une action, puis renvoie toutes les étapes jusqu'à la prochaine décision du joueur. */
  act(action: GameAction): Promise<MatchStep[]>;
}
