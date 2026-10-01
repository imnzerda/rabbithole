import type { MatchContext } from './context.js';
import {
  CARD_TYPES,
  CATEGORIES,
  COUNT_ZONES,
  KEYWORDS,
  RARITIES,
  STATIC_SELECTORS,
  TARGET_SELECTORS,
  TRIGGERS,
  type Action,
  type Amount,
  type CardDef,
  type CardFilter,
  type Condition,
  type Effect,
} from './types.js';

/** Deck : 1 Leader + `deckSize` cartes, `maxCopiesPerCard` exemplaires max, catégories du Leader. */
export function validateDeck(ctx: MatchContext, leaderId: string, cardIds: readonly string[]): string[] {
  const errors: string[] = [];
  const { deckSize, maxCopiesPerCard } = ctx.rules;
  const leader = ctx.cards[leaderId];
  if (!leader) errors.push(`Leader inconnu : ${leaderId}`);
  else if (leader.type !== 'leader') errors.push(`${leaderId} n'est pas un Leader.`);
  if (cardIds.length !== deckSize) errors.push(`Le deck doit contenir ${deckSize} cartes (${cardIds.length}).`);
  const counts = new Map<string, number>();
  for (const id of cardIds) {
    const def = ctx.cards[id];
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!def) {
      errors.push(`Carte inconnue : ${id}`);
      continue;
    }
    if (def.type === 'leader') errors.push(`Un Leader ne va pas dans le deck : ${id}`);
    if (leader?.type === 'leader' && !def.categories.some((c) => leader.categories.includes(c))) {
      errors.push(`${id} ne partage aucune catégorie avec le Leader.`);
    }
  }
  for (const [id, n] of counts) if (n > maxCopiesPerCard) errors.push(`Trop d'exemplaires de ${id} (${n}).`);
  return [...new Set(errors)];
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const includes = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

function checkFilter(f: CardFilter | undefined, path: string, errors: string[]): void {
  if (!f) return;
  for (const c of f.categories ?? []) if (!includes(CATEGORIES, c)) errors.push(`${path}.categories : ${c} inconnue`);
  for (const k of f.keywords ?? []) if (!includes(KEYWORDS, k)) errors.push(`${path}.keywords : ${k} inconnu`);
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
    case 'my_turn':
    case 'opponent_turn':
    case 'attacking_leader':
      return;
    case 'buzz_attached':
      if (!isInt(c.min)) errors.push(`${path}.min invalide`);
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
      checkAmount(a.amount, `${path}.amount`, errors);
      return;
    case 'ko':
    case 'rest':
    case 'refresh':
    case 'bounce':
    case 'steal':
    case 'cancel_effects':
      return;
    case 'draw':
    case 'discard':
    case 'add_buzz':
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

export function validateEffect(e: Effect, path: string, cardType?: CardDef['type']): string[] {
  const errors: string[] = [];
  if (!includes(TRIGGERS, e.trigger)) errors.push(`${path}.trigger inconnu (${e.trigger})`);
  if (e.condition) checkCondition(e.condition, `${path}.condition`, errors);
  checkAction(e.action, `${path}.action`, errors);
  if (e.trigger === 'continuous') {
    if (e.action.type !== 'add_power') errors.push(`${path} : un effet continu ne peut être que add_power`);
    else if (!STATIC_SELECTORS.includes(e.action.target)) errors.push(`${path} : cible ${e.action.target} interdite pour un effet continu`);
  }
  if (cardType === 'event' && !['main', 'counter', 'on_trigger'].includes(e.trigger)) {
    errors.push(`${path} : un Événement n'a que des effets main, counter ou on_trigger`);
  }
  if (cardType !== 'event' && (e.trigger === 'main' || e.trigger === 'counter')) {
    errors.push(`${path} : ${e.trigger} est réservé aux Événements`);
  }
  if (cardType === 'leader' && (e.trigger === 'on_play' || e.trigger === 'on_ko' || e.trigger === 'on_trigger')) {
    errors.push(`${path} : un Leader ne peut pas avoir ${e.trigger}`);
  }
  if (e.buzzCost !== undefined && (!isInt(e.buzzCost) || e.buzzCost < 0 || e.trigger !== 'activate_main')) {
    errors.push(`${path}.buzzCost réservé à activate_main`);
  }
  return errors;
}

/** Validation structurelle d'une carte (éditeur d'admin, pipeline, chargement du catalogue). */
export function validateCardDef(def: CardDef): string[] {
  const errors: string[] = [];
  if (!def.id) errors.push('id manquant');
  if (!includes(CARD_TYPES, def.type)) errors.push(`type inconnu (${def.type})`);
  if (!def.name || Object.keys(def.name).length === 0) errors.push('name manquant');
  if (!isInt(def.cost) || def.cost < 0 || def.cost > 10) errors.push('cost invalide (0 à 10)');
  if (!isInt(def.power) || def.power < 0) errors.push('power invalide');
  if (!includes(RARITIES, def.rarity)) errors.push(`rarity inconnue (${def.rarity})`);
  if (!def.categories?.length || def.categories.length > 2) errors.push('1 ou 2 catégories requises');
  for (const c of def.categories ?? []) if (!includes(CATEGORIES, c)) errors.push(`catégorie inconnue (${c})`);
  for (const k of def.keywords ?? []) {
    if (!includes(KEYWORDS, k)) errors.push(`mot-clé inconnu (${k})`);
    if (k === 'tendance') errors.push('tendance est attribué automatiquement, pas imprimé sur la carte');
  }
  if (def.type === 'leader') {
    if (!isInt(def.life) || def.life < 1 || def.life > 8) errors.push('life invalide (1 à 8) pour un Leader');
    if (def.cost !== 0) errors.push('un Leader a un coût de 0');
  } else if (def.life !== undefined) {
    errors.push('life est réservé aux Leaders');
  }
  if (def.counter !== undefined && (!isInt(def.counter) || def.counter < 0 || def.counter > 3)) errors.push('counter invalide (0 à 3)');
  if (def.type === 'event') {
    if (def.power !== 0) errors.push("un Événement n'a pas de puissance");
    if (!def.effects.some((e) => e.trigger === 'main' || e.trigger === 'counter')) errors.push('un Événement doit avoir un effet main ou counter');
  }
  (def.effects ?? []).forEach((e, i) => errors.push(...validateEffect(e, `effects[${i}]`, def.type)));
  return errors;
}

function collectCardRefs(a: Action, out: string[]): void {
  if (a.type === 'add_card_to_hand') out.push(...a.cards);
  if (a.type === 'random_of') a.options.forEach((o) => collectCardRefs(o, out));
}

/** Valide tout le catalogue, y compris les références entre cartes. */
export function validateCatalog(ctx: MatchContext): Record<string, string[]> {
  const report: Record<string, string[]> = {};
  for (const def of Object.values(ctx.cards)) {
    const errors = validateCardDef(def);
    const refs: string[] = [];
    def.effects.forEach((e) => collectCardRefs(e.action, refs));
    for (const id of refs) if (!ctx.cards[id]) errors.push(`référence à une carte inconnue (${id})`);
    if (errors.length) report[`card:${def.id}`] = errors;
  }
  for (const entry of ctx.rules.keywords.shitpost.table) {
    const errors: string[] = [];
    checkAction(entry.action, 'shitpost', errors);
    if (errors.length) report['rules:shitpost'] = [...(report['rules:shitpost'] ?? []), ...errors];
  }
  return report;
}
