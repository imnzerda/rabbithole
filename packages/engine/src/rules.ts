import type { Action, Duration, KeywordId, Trigger } from './types.js';

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

/**
 * Budget de puissance (section 3.9) : valeur des mots-clés et des effets, en points de puissance.
 * Outil d'équilibrage de l'admin (`cardBudget`), calibré sur le prototype équilibré par simulation.
 */
export interface BudgetConfig {
  /** Puissance de référence d'un Personnage sans effet, par coût (≈ coût + 1). */
  basePower: number[];
  /** Ajustement selon la valeur de Contre : sans Contre +1, Contre 2 −1. */
  counter: number[];
  keywords: Partial<Record<KeywordId, number>>;
  actions: {
    addPower: Record<Duration, number>;
    ko: number;
    rest: number;
    refresh: number;
    bounce: number;
    steal: number;
    cancelEffects: number;
    draw: number;
    discard: number;
    addCard: number;
    addBuzz: number;
  };
  /** Cible multiple (alliés, ennemis) : la valeur est multipliée. */
  massMultiplier: number;
  /** Estimation d'un montant variable (« par allié »…). */
  countAmountEstimate: number;
  /** Moment de l'effet : un effet répétable vaut plus, un effet de KO ou de Vie vaut moins. */
  triggers: Record<Trigger, number>;
  /** Un effet sous condition vaut moins. */
  conditionFactor: number;
  /** Chaque Buzz à payer pour une activation retire de la valeur. */
  buzzCostValue: number;
  /** Un Événement doit valoir à peu près référence × facteur. */
  eventFactor: number;
  /** Écart toléré avant de signaler une carte. */
  tolerance: number;
}

export const DEFAULT_BUDGET: BudgetConfig = {
  basePower: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  counter: [1, 0, -1],
  keywords: { elan: 0.5, bloqueur: 0.5, viral: 1.5, ratio: 0.5, clickbait: 0.5, croissance: 0.5, rickroll: 1.5, cancel: 1, seduction: 1.5, shitpost: 0.5 },
  actions: {
    addPower: { turn: 0.5, battle: 0.5, permanent: 1 },
    ko: 3,
    rest: 1.5,
    refresh: 1,
    bounce: 2,
    steal: 3,
    cancelEffects: 1.5,
    draw: 1,
    discard: 1,
    addCard: 1,
    addBuzz: 1,
  },
  massMultiplier: 2,
  countAmountEstimate: 2,
  triggers: { on_play: 1, on_attack: 1.5, on_ko: 0.7, on_trigger: 0.3, continuous: 2, activate_main: 1.5, end_of_turn: 1.5, main: 1, counter: 1 },
  conditionFactor: 0.7,
  buzzCostValue: 0.5,
  eventFactor: 0.6,
  tolerance: 1,
};
