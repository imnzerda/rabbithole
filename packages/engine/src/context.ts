import { EngineError } from './errors.js';
import { DEFAULT_RULES, mergeRules, type RulesConfig, type RulesOverride } from './rules.js';
import type { CardDef } from './types.js';

/** Données de référence d'une partie : catalogue de cartes et règles. */
export interface MatchContext {
  readonly cards: Readonly<Record<string, CardDef>>;
  readonly rules: RulesConfig;
}

export function createContext(input: { cards: readonly CardDef[]; rules?: RulesOverride }): MatchContext {
  const cards: Record<string, CardDef> = {};
  for (const c of input.cards) cards[c.id] = c;
  return { cards, rules: input.rules ? mergeRules(input.rules) : DEFAULT_RULES };
}

export function getCardDef(ctx: MatchContext, id: string): CardDef {
  const def = ctx.cards[id];
  if (!def) throw new EngineError('unknown_card_def', `Carte inconnue : ${id}`);
  return def;
}
