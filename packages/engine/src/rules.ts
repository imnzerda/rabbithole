import type { Action } from './types.js';

/**
 * Valeurs d'équilibrage et de format. Le serveur peut les charger depuis la base
 * et les passer au contexte ; `DEFAULT_RULES` reflète le cahier des charges.
 */
export interface RulesConfig {
  deckSize: number;
  maxCopiesPerCard: number;
  turns: number;
  terrainCount: number;
  /** Terrains contrôlés nécessaires pour gagner. */
  terrainsToWin: number;
  /** Tour de révélation de chaque terrain (index = position du terrain). */
  terrainRevealTurns: number[];
  /** Autorise la pose sur un terrain pas encore révélé. Désactivé par défaut : on ne joue que sur ce qu'on voit. */
  allowPlayOnUnrevealedTerrain: boolean;
  startingHand: number;
  drawPerTurn: number;
  maxHandSize: number;
  maxCardsPerTerrain: number;
  /** Mana disponible par tour (index 0 = tour 1). */
  manaByTurn: number[];
  minCost: number;
  turnTimerSeconds: number;
  countryTerrainBonus: number;
  hype: {
    baseStake: number;
    multiplier: number;
    maxStake: number;
    autoDoubleFinalTurn: boolean;
  };
  keywords: {
    viral: { powerPenalty: number };
    ratio: { amount: number };
    /** Bonus réel et temporaire : actif le tour de la pose et le tour suivant. */
    clickbait: { bonus: number; durationTurns: number };
    elan: { bonus: number; maxTurn: number };
    croissance: { perTurn: number };
    tendance: { bonus: number };
    shitpost: { table: { weight: number; action: Action }[] };
  };
  /** Profondeur max d'imbrication des `random_of`. */
  maxEffectDepth: number;
}

export const DEFAULT_RULES: RulesConfig = {
  deckSize: 12,
  maxCopiesPerCard: 1,
  turns: 6,
  terrainCount: 3,
  terrainsToWin: 2,
  terrainRevealTurns: [1, 2, 3],
  allowPlayOnUnrevealedTerrain: false,
  startingHand: 3,
  drawPerTurn: 1,
  maxHandSize: 7,
  maxCardsPerTerrain: 4,
  manaByTurn: [1, 2, 3, 4, 5, 6],
  minCost: 0,
  turnTimerSeconds: 30,
  countryTerrainBonus: 2,
  hype: {
    baseStake: 1,
    multiplier: 2,
    maxStake: 4,
    autoDoubleFinalTurn: false,
  },
  keywords: {
    viral: { powerPenalty: 1 },
    ratio: { amount: 3 },
    clickbait: { bonus: 4, durationTurns: 1 },
    elan: { bonus: 2, maxTurn: 3 },
    croissance: { perTurn: 1 },
    tendance: { bonus: 1 },
    shitpost: {
      // Uniquement des bonus sur la carte elle-même : « gagne entre +0 et +8 au hasard ».
      table: [0, 1, 2, 3, 4, 8].map((amount) => ({
        weight: 1,
        action: { type: 'add_power', target: 'self', amount } as Action,
      })),
    },
  },
  maxEffectDepth: 4,
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type RulesOverride = DeepPartial<RulesConfig>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function merge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return (override === undefined ? base : override) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v !== undefined) out[k] = merge((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

/** Fusionne des surcharges partielles (tableaux remplacés, objets fusionnés). */
export function mergeRules(override: RulesOverride = {}, base: RulesConfig = DEFAULT_RULES): RulesConfig {
  return merge(base, override);
}
