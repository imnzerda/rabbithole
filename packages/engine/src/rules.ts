import type { Action } from './types.js';

/**
 * Valeurs de format et d'équilibrage (modèle « duel » inspiré du TCG One Piece,
 * puissances divisées par 1000 pour la lisibilité). Le serveur peut les surcharger
 * depuis la base ; `DEFAULT_RULES` est la référence.
 */
export interface RulesConfig {
  deckSize: number;
  maxCopiesPerCard: number;
  startingHand: number;
  maxCharacters: number;
  /** Buzz : réserve totale, gain par tour, gain du tout premier tour du premier joueur. */
  buzzTotal: number;
  buzzPerTurn: number;
  buzzFirstTurn: number;
  /** Puissance donnée par chaque Buzz attaché, pendant le tour de son contrôleur. */
  buzzPower: number;
  /** Le premier joueur ne pioche pas à son premier tour. */
  firstPlayerSkipsDraw: boolean;
  /** Personne n'attaque pendant son tout premier tour. */
  noAttackOnFirstTurn: boolean;
  /** Au-delà, la partie s'arrête : plus de Vies l'emporte, sinon égalité. */
  maxTurns: number;
  /** Minuteurs (gérés par le serveur / l'UI, pas par le moteur). */
  turnTimerSeconds: number;
  reactionTimerSeconds: number;
  hype: {
    baseStake: number;
    multiplier: number;
    maxStake: number;
  };
  keywords: {
    viral: { damage: number };
    clickbait: { bonus: number };
    croissance: { perTurn: number };
    tendance: { bonus: number };
    /** Séduction : coût maximum du personnage volé. */
    seduction: { maxCost: number };
    /** Rickroll : coût maximum du personnage épuisé. */
    rickroll: { maxCost: number };
    shitpost: { table: { weight: number; action: Action }[] };
  };
  maxEffectDepth: number;
}

export const DEFAULT_RULES: RulesConfig = {
  deckSize: 20,
  maxCopiesPerCard: 2,
  startingHand: 5,
  maxCharacters: 5,
  buzzTotal: 10,
  buzzPerTurn: 2,
  buzzFirstTurn: 1,
  buzzPower: 1,
  firstPlayerSkipsDraw: true,
  noAttackOnFirstTurn: true,
  maxTurns: 40,
  turnTimerSeconds: 60,
  reactionTimerSeconds: 20,
  hype: {
    baseStake: 1,
    multiplier: 2,
    maxStake: 4,
  },
  keywords: {
    viral: { damage: 2 },
    clickbait: { bonus: 2 },
    croissance: { perTurn: 1 },
    tendance: { bonus: 1 },
    seduction: { maxCost: 2 },
    rickroll: { maxCost: 5 },
    shitpost: {
      // « Au hasard : pioche 1, +2 jusqu'à la fin du tour, ou +1 définitif. »
      table: [
        { weight: 1, action: { type: 'draw', amount: 1 } },
        { weight: 1, action: { type: 'add_power', target: 'self', amount: 2, duration: 'turn' } },
        { weight: 1, action: { type: 'add_power', target: 'self', amount: 1, duration: 'permanent' } },
      ],
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
