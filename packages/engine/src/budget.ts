import { DEFAULT_BUDGET, type BudgetConfig } from './rules.js';
import type { Action, Amount, CardDef, Effect } from './types.js';

/**
 * Budget de puissance (section 3.9) : outil d'équilibrage de l'admin, jamais utilisé en partie.
 *
 * Personnage : puissance attendue = référence du coût + ajustement du Contre − valeur des mots-clés
 * − valeur des effets. L'écart avec la puissance imprimée signale une carte trop forte ou trop faible.
 * Événement : les effets doivent valoir à peu près la référence de son coût.
 * Leader : seuls les effets sont chiffrés (pas de coût).
 * Les valeurs sont dans `DEFAULT_BUDGET` (rules.ts), à ajuster avec les simulations IA contre IA.
 */

export interface BudgetLine {
  label: string;
  value: number;
}

export interface BudgetReport {
  /** Puissance de référence d'un Personnage sans effet de ce coût. */
  reference: number;
  /** Puissance attendue (Personnage) ou valeur attendue des effets (Événement). */
  expected: number;
  /** Puissance imprimée (Personnage) ou valeur des effets (Événement, Leader). */
  actual: number;
  /** actual − expected : > 0 trop forte, < 0 trop faible. */
  delta: number;
  verdict: 'ok' | 'strong' | 'weak';
  lines: BudgetLine[];
}

const round = (n: number) => Math.round(n * 10) / 10;

function amountValue(a: Amount, cfg: BudgetConfig): number {
  return typeof a === 'number' ? a : cfg.countAmountEstimate * (a.multiplier ?? 1) + (a.base ?? 0);
}

const MASS_TARGETS = new Set(['allies', 'enemies', 'all_mine']);
// `battle_target` : la carte attaquée, la sienne pendant un Contre (usage principal des bonus sur cette cible).
const ALLY_TARGETS = new Set(['self', 'my_leader', 'allies', 'all_mine', 'strongest_ally', 'weakest_ally', 'battle_target']);

/** Valeur d'une action, en points de puissance. */
export function actionValue(action: Action, cfg: BudgetConfig = DEFAULT_BUDGET): number {
  const a = cfg.actions;
  const mass = 'target' in action && MASS_TARGETS.has(action.target) ? cfg.massMultiplier : 1;
  const capped = 'filter' in action && action.filter?.maxCost !== undefined ? Math.min(1, (action.filter.maxCost + 1) / 7) : 1;
  switch (action.type) {
    case 'add_power': {
      const n = amountValue(action.amount, cfg);
      const per = a.addPower[action.duration ?? 'turn'];
      // Bonus pour soi ou malus pour l'adversaire : positif ; l'inverse est un inconvénient.
      const good = n > 0 === ALLY_TARGETS.has(action.target);
      return (good ? 1 : -1) * Math.abs(n) * per * mass;
    }
    case 'ko':
      return a.ko * capped * mass;
    case 'rest':
      return a.rest * capped * mass;
    case 'refresh':
      return a.refresh * mass;
    case 'bounce':
      return a.bounce * capped * mass;
    case 'steal':
      return a.steal * capped;
    case 'cancel_effects':
      return a.cancelEffects * mass;
    case 'draw':
      return a.draw * action.amount * (action.side === 'enemy' ? -1 : 1);
    case 'discard':
      return a.discard * action.amount * (action.side === 'enemy' ? 1 : -0.5);
    case 'add_card_to_hand':
      return a.addCard * (action.count ?? (action.pick === 'random' ? 1 : action.cards.length));
    case 'add_buzz':
      return a.addBuzz * action.amount;
    case 'random_of': {
      const weights = action.weights ?? action.options.map(() => 1);
      const total = weights.reduce((s, w) => s + w, 0) || 1;
      return action.options.reduce((s, o, i) => s + (actionValue(o, cfg) * (weights[i] ?? 1)) / total, 0);
    }
  }
}

/** Valeur d'un effet : action × moment, réduite par une condition, diminuée du coût d'activation. */
export function effectValue(effect: Effect, cfg: BudgetConfig = DEFAULT_BUDGET): number {
  const base = actionValue(effect.action, cfg) * cfg.triggers[effect.trigger];
  const conditioned = effect.condition ? base * cfg.conditionFactor : base;
  // Un inconvénient (valeur négative) reste négatif ; un coût d'activation réduit un avantage.
  return conditioned <= 0 ? conditioned : Math.max(0, conditioned - (effect.buzzCost ?? 0) * cfg.buzzCostValue);
}

export function referencePower(cost: number, cfg: BudgetConfig = DEFAULT_BUDGET): number {
  return cfg.basePower[Math.max(0, Math.min(cost, cfg.basePower.length - 1))]!;
}

export function cardBudget(def: CardDef, cfg: BudgetConfig = DEFAULT_BUDGET): BudgetReport {
  const lines: BudgetLine[] = [];
  const reference = def.type === 'leader' ? 0 : referencePower(def.cost, cfg);
  lines.push({ label: def.type === 'leader' ? 'Leader : pas de coût' : `Référence (coût ${def.cost})`, value: reference });

  let effects = 0;
  for (const kw of def.keywords) {
    const v = cfg.keywords[kw];
    if (v) {
      lines.push({ label: `Mot-clé ${kw}`, value: -v });
      effects += v;
    }
  }
  def.effects.forEach((e, i) => {
    // Un Déclencheur ne joue que si la carte est révélée en Vie : il compte peu (voir `triggers.on_trigger`).
    const v = round(effectValue(e, cfg));
    lines.push({ label: `Effet ${i + 1} (${e.trigger}, ${e.action.type})`, value: -v });
    effects += v;
  });

  if (def.type === 'character') {
    const counterAdj = cfg.counter[Math.min(def.counter ?? 0, 2)] ?? 0;
    lines.push({ label: `Contre ${def.counter ?? 0}`, value: counterAdj });
    const expected = round(reference + counterAdj - effects);
    const delta = round(def.power - expected);
    return { reference, expected, actual: def.power, delta, verdict: verdictOf(delta, cfg), lines };
  }
  // Événement : la valeur des effets doit suivre la référence du coût ; Leader : pour information.
  const expected = def.type === 'event' ? round(reference * cfg.eventFactor) : 0;
  const actual = round(effects);
  const delta = def.type === 'event' ? round(actual - expected) : 0;
  return { reference, expected, actual, delta, verdict: def.type === 'event' ? verdictOf(delta, cfg) : 'ok', lines };
}

function verdictOf(delta: number, cfg: BudgetConfig): BudgetReport['verdict'] {
  if (delta > cfg.tolerance) return 'strong';
  if (delta < -cfg.tolerance) return 'weak';
  return 'ok';
}

/** Rapport de tout un catalogue : les cartes hors norme d'abord. */
export function catalogBudget(cards: readonly CardDef[], cfg: BudgetConfig = DEFAULT_BUDGET): { id: string; report: BudgetReport }[] {
  return cards
    .filter((c) => c.type !== 'leader')
    .map((c) => ({ id: c.id, report: cardBudget(c, cfg) }))
    .sort((a, b) => Math.abs(b.report.delta) - Math.abs(a.report.delta));
}

