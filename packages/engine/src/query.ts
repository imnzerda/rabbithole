import { getCardDef, getTerrainDef, type MatchContext } from './context.js';
import {
  other,
  type Amount,
  type CardFilter,
  type CardInstance,
  type Condition,
  type CountZone,
  type MatchState,
  type PlayerIndex,
  type Side,
  type TargetSelector,
  type TerrainDef,
  type TerrainModifier,
  type TerrainState,
} from './types.js';

/** Contexte d'exécution d'un effet : la carte source et sa position actuelle. */
export interface Source {
  uid: string | null;
  controller: PlayerIndex;
  terrain: number | null;
}

export function sourceOf(card: CardInstance): Source {
  return { uid: card.uid, controller: card.controller, terrain: card.terrain };
}

export function sidePlayer(controller: PlayerIndex, side: Side | undefined): PlayerIndex {
  return side === 'enemy' ? other(controller) : controller;
}

export function terrainAt(s: MatchState, index: number): TerrainState {
  const t = s.terrains[index];
  if (!t) throw new RangeError(`Terrain hors limites : ${index}`);
  return t;
}

/** Définition du terrain si révélé (un terrain caché n'a aucun effet). */
export function activeTerrainDef(ctx: MatchContext, s: MatchState, index: number | null): TerrainDef | null {
  if (index === null) return null;
  const t = terrainAt(s, index);
  return t.revealed ? getTerrainDef(ctx, t.defId) : null;
}

export function terrainHasModifier(
  ctx: MatchContext,
  s: MatchState,
  index: number | null,
  type: TerrainModifier['type'],
): boolean {
  return activeTerrainDef(ctx, s, index)?.modifiers.some((m) => m.type === type) ?? false;
}

export function isOnBoard(c: CardInstance): boolean {
  return c.zone === 'board' && c.terrain !== null;
}

export function isTrending(s: MatchState, c: CardInstance): boolean {
  return s.trending.includes(c.defId);
}

export function matchesFilter(ctx: MatchContext, s: MatchState, c: CardInstance, f: CardFilter | undefined): boolean {
  if (!f) return true;
  const def = getCardDef(ctx, c.defId);
  if (f.categories && !f.categories.some((cat) => def.categories.includes(cat))) return false;
  if (f.countries && (def.country === undefined || !f.countries.includes(def.country))) return false;
  if (f.keywords) {
    const has = f.keywords.some((k) => def.keywords.includes(k) || (k === 'tendance' && isTrending(s, c)));
    if (!has) return false;
  }
  if (f.rarities && !f.rarities.includes(def.rarity)) return false;
  if (f.cardIds && !f.cardIds.includes(def.id)) return false;
  if (f.minCost !== undefined && def.cost < f.minCost) return false;
  if (f.maxCost !== undefined && def.cost > f.maxCost) return false;
  if (f.playedThisTurn !== undefined && (c.playedTurn === s.turn) !== f.playedThisTurn) return false;
  return true;
}

/** Cartes révélées d'un joueur sur un terrain. */
export function revealedOn(s: MatchState, terrain: number, player: PlayerIndex): CardInstance[] {
  return terrainAt(s, terrain)
    .slots[player].map((uid) => s.cards[uid])
    .filter((c): c is CardInstance => c !== undefined && c.revealed);
}

function zoneCards(s: MatchState, src: Source, zone: CountZone): CardInstance[] {
  const notSelf = (c: CardInstance) => c.uid !== src.uid;
  const everywhere = (p: PlayerIndex) => s.terrains.flatMap((_, i) => revealedOn(s, i, p));
  switch (zone) {
    case 'allies_here':
      return src.terrain === null ? [] : revealedOn(s, src.terrain, src.controller).filter(notSelf);
    case 'enemies_here':
      return src.terrain === null ? [] : revealedOn(s, src.terrain, other(src.controller));
    case 'all_here':
      return src.terrain === null
        ? []
        : [...revealedOn(s, src.terrain, src.controller), ...revealedOn(s, src.terrain, other(src.controller))].filter(
            notSelf,
          );
    case 'allies_everywhere':
      return everywhere(src.controller).filter(notSelf);
    case 'enemies_everywhere':
      return everywhere(other(src.controller));
    case 'hand':
      return s.players[src.controller].hand.map((uid) => s.cards[uid]).filter((c): c is CardInstance => !!c);
  }
}

export function countZone(
  ctx: MatchContext,
  s: MatchState,
  src: Source,
  zone: CountZone,
  filter: CardFilter | undefined,
): number {
  return zoneCards(s, src, zone).filter((c) => matchesFilter(ctx, s, c, filter)).length;
}

export function evalAmount(ctx: MatchContext, s: MatchState, src: Source, amount: Amount): number {
  if (typeof amount === 'number') return amount;
  return (amount.base ?? 0) + (amount.multiplier ?? 1) * countZone(ctx, s, src, amount.zone, amount.filter);
}

const inRange = (v: number, min?: number, max?: number) =>
  (min === undefined || v >= min) && (max === undefined || v <= max);

export function evalCondition(ctx: MatchContext, s: MatchState, src: Source, cond: Condition): boolean {
  switch (cond.type) {
    case 'count':
      return inRange(countZone(ctx, s, src, cond.zone, cond.filter), cond.min, cond.max);
    case 'terrain_has_category': {
      const zone: CountZone =
        cond.side === 'allies' ? 'allies_here' : cond.side === 'enemies' ? 'enemies_here' : 'all_here';
      return countZone(ctx, s, src, zone, { categories: [cond.category] }) >= cond.min;
    }
    case 'turn':
      return inRange(s.turn, cond.min, cond.max);
    case 'played_on_turn': {
      const c = src.uid ? s.cards[src.uid] : undefined;
      return c?.playedTurn != null && inRange(c.playedTurn, cond.min, cond.max);
    }
    case 'hand_size':
      return inRange(s.players[sidePlayer(src.controller, cond.side)].hand.length, cond.min, cond.max);
    case 'terrain_is':
      return src.terrain !== null && cond.terrainIds.includes(terrainAt(s, src.terrain).defId);
    case 'and':
      return cond.conditions.every((c) => evalCondition(ctx, s, src, c));
    case 'or':
      return cond.conditions.some((c) => evalCondition(ctx, s, src, c));
    case 'not':
      return !evalCondition(ctx, s, src, cond.condition);
  }
}

/**
 * Cibles déterministes et indépendantes de la puissance.
 * Les sélecteurs aléatoires ou basés sur la puissance sont résolus par le `Resolver`.
 */
export function staticTargets(
  ctx: MatchContext,
  s: MatchState,
  src: Source,
  selector: TargetSelector,
  filter: CardFilter | undefined,
  side: Side | undefined,
): CardInstance[] {
  let cards: CardInstance[];
  switch (selector) {
    case 'self': {
      const c = src.uid ? s.cards[src.uid] : undefined;
      cards = c ? [c] : [];
      break;
    }
    case 'allies_here':
    case 'enemies_here':
    case 'all_here':
      cards = zoneCards(s, src, selector);
      break;
    case 'opposite_card': {
      if (src.terrain === null || src.uid === null) return [];
      const t = terrainAt(s, src.terrain);
      const index = t.slots[src.controller].indexOf(src.uid);
      const uid = index >= 0 ? t.slots[other(src.controller)][index] : undefined;
      const c = uid ? s.cards[uid] : undefined;
      cards = c && c.revealed ? [c] : [];
      break;
    }
    case 'hand':
    case 'deck': {
      const p = s.players[sidePlayer(src.controller, side)];
      cards = (selector === 'hand' ? p.hand : p.deck).map((uid) => s.cards[uid]).filter((c): c is CardInstance => !!c);
      break;
    }
    case 'random_enemy_here':
    case 'strongest_enemy_here':
    case 'weakest_enemy_here':
      cards = zoneCards(s, src, 'enemies_here');
      break;
  }
  return cards.filter((c) => matchesFilter(ctx, s, c, filter));
}

/** Coût d'une carte posée sur un terrain (modificateurs de terrain inclus). */
export function playCost(ctx: MatchContext, s: MatchState, c: CardInstance, terrain: number): number {
  let cost = getCardDef(ctx, c.defId).cost;
  const tdef = activeTerrainDef(ctx, s, terrain);
  if (tdef) {
    for (const m of tdef.modifiers) {
      if (m.type === 'cost' && matchesFilter(ctx, s, c, m.filter)) cost += m.amount;
    }
  }
  return Math.max(ctx.rules.minCost, cost);
}

export function manaForTurn(ctx: MatchContext, turn: number): number {
  return ctx.rules.manaByTurn[turn - 1] ?? turn;
}
