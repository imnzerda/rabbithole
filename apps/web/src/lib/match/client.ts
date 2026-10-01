import type { GameAction, MatchContext, MatchEvent, PlayerView } from '@rabbithole/engine';

/** Une étape de jeu : les événements à animer, puis la vue qui fait foi. */
export interface MatchStep {
  events: MatchEvent[];
  view: PlayerView;
  /** Fin du minuteur de la décision en cours (ms epoch), ou null. */
  deadline: number | null;
}

export interface MatchError {
  code: string;
  message: string;
}

/**
 * Contrat entre l'UI et une partie. L'UI ne voit que des `PlayerView` et des événements
 * (jamais l'état complet), reçus en continu : l'adversaire peut agir à tout moment.
 * Implémentations : `LocalMatch` (IA dans le navigateur, entraînement), `OnlineMatch`
 * (serveur WebSocket, qui fait foi) et `ReplayMatch` (relecture d'une partie enregistrée).
 */
export interface MatchClient {
  /** Catalogue public (définitions des cartes, règles) pour l'affichage. */
  readonly ctx: MatchContext;
  /** Nom de l'adversaire, à afficher. */
  readonly opponentName: string;
  /** Lecture seule (replay) : aucune action possible. */
  readonly spectator: boolean;
  onStep(listener: (step: MatchStep) => void): () => void;
  onError(listener: (error: MatchError) => void): () => void;
  onReward(listener: (coins: number | null) => void): () => void;
  /** Envoie une action ; le résultat arrive sous forme d'étapes. */
  act(action: GameAction): void;
  /** Commence à émettre les étapes (après l'abonnement de l'UI). */
  start(): void;
  close(): void;
}

/** Petite base commune : gestion des abonnés. */
export abstract class BaseMatchClient {
  private stepListeners = new Set<(step: MatchStep) => void>();
  private errorListeners = new Set<(error: MatchError) => void>();
  private rewardListeners = new Set<(coins: number | null) => void>();

  /** Pièces gagnées en fin de partie (en ligne uniquement). */
  onReward(listener: (coins: number | null) => void): () => void {
    this.rewardListeners.add(listener);
    return () => this.rewardListeners.delete(listener);
  }

  protected emitReward(coins: number | null): void {
    for (const l of this.rewardListeners) l(coins);
  }

  onStep(listener: (step: MatchStep) => void): () => void {
    this.stepListeners.add(listener);
    return () => this.stepListeners.delete(listener);
  }

  onError(listener: (error: MatchError) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  protected emitStep(step: MatchStep): void {
    for (const l of this.stepListeners) l(step);
  }

  protected emitError(error: MatchError): void {
    for (const l of this.errorListeners) l(error);
  }
}
