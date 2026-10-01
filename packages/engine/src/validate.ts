import type { MatchContext } from './context.js';
import {
  CATEGORIES,
  COUNT_ZONES,
  KEYWORDS,
  RARITIES,
  STATIC_BOARD_SELECTORS,
  TARGET_SELECTORS,
  TRIGGERS,
  type Action,
  type Amount,
  type CardDef,
  type CardFilter,
  type Condition,
  type Effect,
  type TerrainDef,
} from './types.js';

export function validateDeck(ctx: MatchContext, cardIds: readonly string[]): string[] {
  const errors: string[] = [];
  const { deckSize, maxCopiesPerCard } = ctx.rules;
  if (cardIds.length !== deckSize) errors.push(`Le deck doit contenir ${deckSize} cartes (${cardIds.length}).`);
  const counts = new Map<string, number>();
  for (const id of cardIds) {
    if (!ctx.cards[id]) errors.push(`Carte inconnue : ${id}`);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, n] of counts) {
    if (n > maxCopiesPerCard) errors.push(`Trop d'exemplaires de ${id} (${n}).`);
  }
  return errors;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const includes = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

function checkFilter(f: CardFilter | undefined, path: string, errors: string[]): void {
  if (!f) return;
  for (const c of f.categories ?? []) if (!includes(CATEGORIES, c)) errors.push(`${path}.categories : ${c} inconnue`);
  for (const k of f.keywords ?? []) if (!includes(KEYWORDS, k)) errors.push(`${path}.keywords : ${k} inconnu`);
  for (const r of f.rarities ?? []) if (!includes(RARITIES, r)) errors.push(`${path}.rarities : ${r} inconnue`);
}

function checkAmount(a: Amount, path: string, errors: string[]): void {
  if (typeof a === 'number') {
    if (!isInt(a)) errors.push(`${path} : entier attendu`);
    return;
  }
  if (a.type !== 'count' || !includes(COUNT_ZONES, a.zone)) errors.push(`${path} : montant dynamique invalide`);
  checkFilter(a.filter, `${path}.filter`, errors);
}

function checkCondition(c: Condition, path: string, errors: string[], depth = 0): void {
  if (depth > 8) {
    errors.push(`${path} : condition trop imbriquée`);
    return;
  }
  switch (c.type) {
    case 'count':
      if (!includes(COUNT_ZONES, c.zone)) errors.push(`${path}.zone invalide`);
      checkFilter(c.filter, `${path}.filter`, errors);
      return;
    case 'terrain_has_category':
      if (!includes(CATEGORIES, c.category)) errors.push(`${path}.category invalide`);
      if (!isInt(c.min)) errors.push(`${path}.min invalide`);
      return;
    case 'turn':
    case 'played_on_turn':
    case 'hand_size':
      return;
    case 'terrain_is':
      if (!c.terrainIds?.length) errors.push(`${path}.terrainIds vide`);
      return;
    case 'and':
    case 'or':
      c.conditions.forEach((sub, i) => checkCondition(sub, `${path}.conditions[${i}]`, errors, depth + 1));
      return;
    case 'not':
      checkCondition(c.condition, `${path}.condition`, errors, depth + 1);
      return;
    default:
      errors.push(`${path} : type de condition inconnu (${(c as { type: string }).type})`);
  }
}

function checkAction(a: Action, path: string, errors: string[], depth = 0): void {
  if ('target' in a) {
    if (!includes(TARGET_SELECTORS, a.target)) errors.push(`${path}.target invalide (${a.target})`);
    checkFilter(a.filter, `${path}.filter`, errors);
  }
  switch (a.type) {
    case 'add_power':
    case 'set_power':
      checkAmount(a.amount, `${path}.amount`, errors);
      return;
    case 'destroy':
    case 'move':
    case 'steal':
    case 'hide':
      if (a.target === 'hand' || a.target === 'deck') errors.push(`${path} : ${a.type} ne vise que le plateau`);
      return;
    case 'copy':
    case 'transform':
    case 'cancel_effects':
      if (a.type === 'transform' && !a.into?.length) errors.push(`${path}.into vide`);
      return;
    case 'draw':
    case 'discard':
      if (!isInt(a.amount) || a.amount < 0) errors.push(`${path}.amount invalide`);
      return;
    case 'add_card_to_hand':
      if (!a.cards?.length) errors.push(`${path}.cards vide`);
      return;
    case 'random_of':
      if (!a.options?.length) errors.push(`${path}.options vide`);
      if (a.weights && (a.weights.length !== a.options.length || a.weights.some((w) => !isInt(w) || w < 0))) {
        errors.push(`${path}.weights invalides`);
      }
      if (depth > 3) errors.push(`${path} : random_of trop imbriqué`);
      a.options?.forEach((o, i) => checkAction(o, `${path}.options[${i}]`, errors, depth + 1));
      return;
    default:
      errors.push(`${path} : type d'action inconnu (${(a as { type: string }).type})`);
  }
}

export function validateEffect(e: Effect, path: string): string[] {
  const errors: string[] = [];
  if (!includes(TRIGGERS, e.trigger)) errors.push(`${path}.trigger inconnu (${e.trigger})`);
  if (e.condition) checkCondition(e.condition, `${path}.condition`, errors);
  checkAction(e.action, `${path}.action`, errors);
  if (e.trigger === 'continuous') {
    if (e.action.type !== 'add_power') errors.push(`${path} : un effet continu ne peut être que add_power`);
    else if (!STATIC_BOARD_SELECTORS.includes(e.action.target)) {
      errors.push(`${path} : cible ${e.action.target} interdite pour un effet continu`);
    }
  }
  return errors;
}

/** Validation structurelle d'une carte (éditeur d'admin, pipeline, chargement du catalogue). */
export function validateCardDef(def: CardDef): string[] {
  const errors: string[] = [];
  if (!def.id) errors.push('id manquant');
  if (!def.name || Object.keys(def.name).length === 0) errors.push('name manquant');
  if (!isInt(def.cost) || def.cost < 0) errors.push('cost invalide');
  if (!isInt(def.power)) errors.push('power invalide');
  if (!includes(RARITIES, def.rarity)) errors.push(`rarity inconnue (${def.rarity})`);
  if (!def.categories?.length || def.categories.length > 2) errors.push('1 ou 2 catégories requises');
  for (const c of def.categories ?? []) if (!includes(CATEGORIES, c)) errors.push(`catégorie inconnue (${c})`);
  for (const k of def.keywords ?? []) {
    if (!includes(KEYWORDS, k)) errors.push(`mot-clé inconnu (${k})`);
    if (k === 'tendance') errors.push('tendance est attribué automatiquement, pas imprimé sur la carte');
  }
  (def.effects ?? []).forEach((e, i) => errors.push(...validateEffect(e, `effects[${i}]`)));
  return errors;
}

export function validateTerrainDef(def: TerrainDef): string[] {
  const errors: string[] = [];
  if (!def.id) errors.push('id manquant');
  if (def.favoredCategory && !includes(CATEGORIES, def.favoredCategory)) errors.push('favoredCategory inconnue');
  def.modifiers.forEach((m, i) => {
    if ((m.type === 'power' || m.type === 'cost' || m.type === 'aura') && !isInt(m.amount)) {
      errors.push(`modifiers[${i}].amount invalide`);
    }
    if (m.type === 'power' || m.type === 'cost' || m.type === 'aura') checkFilter(m.filter, `modifiers[${i}].filter`, errors);
  });
  return errors;
}

function collectCardRefs(a: Action, out: string[]): void {
  if (a.type === 'transform') out.push(...a.into);
  if (a.type === 'add_card_to_hand') out.push(...a.cards);
  if (a.type === 'random_of') a.options.forEach((o) => collectCardRefs(o, out));
}

/** Valide tout le catalogue, y compris les références entre cartes (transform, add_card_to_hand). */
export function validateCatalog(ctx: MatchContext): Record<string, string[]> {
  const report: Record<string, string[]> = {};
  for (const def of Object.values(ctx.cards)) {
    const errors = validateCardDef(def);
    const refs: string[] = [];
    def.effects.forEach((e) => collectCardRefs(e.action, refs));
    for (const id of refs) if (!ctx.cards[id]) errors.push(`référence à une carte inconnue (${id})`);
    if (errors.length) report[`card:${def.id}`] = errors;
  }
  for (const def of Object.values(ctx.terrains)) {
    const errors = validateTerrainDef(def);
    if (errors.length) report[`terrain:${def.id}`] = errors;
  }
  for (const entry of ctx.rules.keywords.shitpost.table) {
    const errors: string[] = [];
    checkAction(entry.action, 'shitpost', errors);
    if (errors.length) report['rules:shitpost'] = [...(report['rules:shitpost'] ?? []), ...errors];
  }
  return report;
}
