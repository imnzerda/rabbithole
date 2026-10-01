import { EngineError } from './errors.js';
import { DEFAULT_RULES, mergeRules, type RulesConfig, type RulesOverride } from './rules.js';
import type { CardDef, TerrainDef } from './types.js';

/** Données de référence d'une partie : catalogue de cartes, terrains, règles. */
export interface MatchContext {
  readonly cards: Readonly<Record<string, CardDef>>;
  readonly terrains: Readonly<Record<string, TerrainDef>>;
  readonly rules: RulesConfig;
}

export function createContext(input: {
  cards: readonly CardDef[];
  terrains: readonly TerrainDef[];
  rules?: RulesOverride;
}): MatchContext {
  const cards: Record<string, CardDef> = {};
  for (const c of input.cards) cards[c.id] = c;
  const terrains: Record<string, TerrainDef> = {};
  for (const t of input.terrains) terrains[t.id] = t;
  return { cards, terrains, rules: input.rules ? mergeRules(input.rules) : DEFAULT_RULES };
}

export function getCardDef(ctx: MatchContext, id: string): CardDef {
  const def = ctx.cards[id];
  if (!def) throw new EngineError('unknown_card_def', `Carte inconnue : ${id}`);
  return def;
}

export function getTerrainDef(ctx: MatchContext, id: string): TerrainDef {
  const def = ctx.terrains[id];
  if (!def) throw new EngineError('unknown_terrain_def', `Terrain inconnu : ${id}`);
  return def;
}
