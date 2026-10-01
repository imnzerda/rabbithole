export * from './types.js';
export { Rng, type RngState } from './rng.js';
export { DEFAULT_RULES, DEFAULT_BUDGET, mergeRules, type RulesConfig, type RulesOverride, type BudgetConfig } from './rules.js';
export { cardBudget, catalogBudget, actionValue, effectValue, referencePower, type BudgetReport, type BudgetLine } from './budget.js';
export { EngineError, type EngineErrorCode } from './errors.js';
export { createContext, getCardDef, type MatchContext } from './context.js';
export {
  createMatch,
  applyAction,
  pendingDecision,
  timeoutAction,
  legalActions,
  canPlay,
  canAttackWith,
  canActivate,
  canDeclareHype,
  attackTargets,
  blockersOf,
  counterOptions,
  cloneState,
  type Decision,
  type LegalActions,
  type CounterOption,
} from './match.js';
export { computePowers, powerOf, type PowerMap } from './power.js';
export { matchesFilter } from './query.js';
export { getPlayerView, eventsFor, HIDDEN_UID, type PlayerView, type SideView, type BattleView, type VisibleCard } from './view.js';
export { validateDeck, validateCardDef, validateEffect, validateCatalog } from './validate.js';
export {
  keywordText,
  rulesSummary,
  actionText,
  effectText,
  cardText,
  CATEGORY_NAMES,
  KEYWORD_NAMES,
  type GlossaryLocale,
  type CardTextLine,
} from './glossary.js';
export { chooseAction } from './ai.js';
export { simulateMatchup, type SimDeck, type SimulationResult } from './simulate.js';
