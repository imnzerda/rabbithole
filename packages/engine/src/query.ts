import { getCardDef, type MatchContext } from './context.js';
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
} from './types.js';

/** Contexte d'exécution d'un effet : la carte source et son contrôleur. */
export interface Source {
  uid: string | null;
  controller: PlayerIndex;
}

export function sourceOf(card: CardInstance): Source {
  return { uid: card.uid, controller: card.controller };
}

export function sidePlayer(controller: PlayerIndex, side: Side | undefined): PlayerIndex {
  return side === 'enemy' ? other(controller) : controller;
}

export function cardsOf(s: MatchState, uids: readonly string[]): CardInstance[] {
  return uids.map((uid) => s.cards[uid]).filter((c): c is CardInstance => c !== undefined);
}

export function leaderOf(s: MatchState, p: PlayerIndex): CardInstance {
  return s.cards[s.players[p].leader]!;
}

export function charactersOf(s: MatchState, p: PlayerIndex): CardInstance[] {
  return cardsOf(s, s.players[p].characters);
}

/** Leader + personnages d'un joueur, dans un ordre stable. */
export function boardOf(s: MatchState, p: PlayerIndex): CardInstance[] {
  return [leaderOf(s, p), ...charactersOf(s, p)];
}

export function isTrending(s: MatchState, c: CardInstance): boolean {
  return s.trending.includes(c.defId);
}

export function hasKeyword(ctx: MatchContext, c: CardInstance, k: string): boolean {
  return !c.effectsCancelled && getCardDef(ctx, c.defId).keywords.includes(k as never);
}

export function matchesFilter(ctx: MatchContext, s: MatchState, c: CardInstance, f: CardFilter | undefined): boolean {
  if (!f) return true;
  const def = getCardDef(ctx, c.defId);
  if (f.categories && !f.categories.some((cat) => def.categories.includes(cat))) return false;
  if (f.keywords && !f.keywords.some((k) => def.keywords.includes(k) || (k === 'tendance' && isTrending(s, c)))) return false;
  if (f.cardIds && !f.cardIds.includes(def.id)) return false;
  if (f.minCost !== undefined && def.cost < f.minCost) return false;
  if (f.maxCost !== undefined && def.cost > f.maxCost) return false;
  if (f.maxPower !== undefined && def.power + c.permMod > f.maxPower) return false;
  if (f.rested !== undefined && c.rested !== f.rested) return false;
  return true;
}

function zoneCards(s: MatchState, src: Source, zone: CountZone): CardInstance[] {
  const me = src.controller;
  const notSelf = (c: CardInstance) => c.uid !== src.uid;
  switch (zone) {
    case 'allies':
      return charactersOf(s, me).filter(notSelf);
    case 'enemies':
      return charactersOf(s, other(me));
    case 'hand':
      return cardsOf(s, s.players[me].hand);
    case 'enemy_hand':
      return cardsOf(s, s.players[other(me)].hand);
    case 'life':
      return cardsOf(s, s.players[me].life);
    case 'enemy_life':
      return cardsOf(s, s.players[other(me)].life);
    case 'trash':
      return cardsOf(s, s.players[me].trash);
  }
}

export function countZone(ctx: MatchContext, s: MatchState, src: Source, zone: CountZone, filter: CardFilter | undefined): number {
  const cards = zoneCards(s, src, zone);
  // Les cartes Vie et la main adverse sont cachées : on ne filtre jamais dessus.
  if (zone === 'life' || zone === 'enemy_life' || zone === 'enemy_hand') return cards.length;
  return cards.filter((c) => matchesFilter(ctx, s, c, filter)).length;
}

export function evalAmount(ctx: MatchContext, s: MatchState, src: Source, amount: Amount): number {
  if (typeof amount === 'number') return amount;
  return (amount.base ?? 0) + (amount.multiplier ?? 1) * countZone(ctx, s, src, amount.zone, amount.filter);
}

const inRange = (v: number, min?: number, max?: number) => (min === undefined || v >= min) && (max === undefined || v <= max);

export function evalCondition(ctx: MatchContext, s: MatchState, src: Source, cond: Condition): boolean {
  switch (cond.type) {
    case 'count':
      return inRange(countZone(ctx, s, src, cond.zone, cond.filter), cond.min, cond.max);
    case 'my_turn':
      return s.active === src.controller;
    case 'opponent_turn':
      return s.active !== src.controller;
    case 'buzz_attached': {
      const c = src.uid ? s.cards[src.uid] : undefined;
      return (c?.buzz ?? 0) >= cond.min;
    }
    case 'attacking_leader': {
      const b = s.battle;
      return !!b && b.attacker === src.uid && s.cards[b.target]?.zone === 'leader';
    }
    case 'and':
      return cond.conditions.every((c) => evalCondition(ctx, s, src, c));
    case 'or':
      return cond.conditions.some((c) => evalCondition(ctx, s, src, c));
    case 'not':
      return !evalCondition(ctx, s, src, cond.condition);
  }
}

/**
 * Candidats d'un sélecteur (avant choix aléatoire ou par puissance, fait par le `Resolver`).
 * Seuls les Leaders et Personnages en jeu sont ciblables.
 */
export function candidateTargets(
  ctx: MatchContext,
  s: MatchState,
  src: Source,
  selector: TargetSelector,
  filter: CardFilter | undefined,
): CardInstance[] {
  const me = src.controller;
  let cards: CardInstance[];
  switch (selector) {
    case 'self': {
      const c = src.uid ? s.cards[src.uid] : undefined;
      cards = c && (c.zone === 'field' || c.zone === 'leader') ? [c] : [];
      break;
    }
    case 'my_leader':
      cards = [leaderOf(s, me)];
      break;
    case 'enemy_leader':
      cards = [leaderOf(s, other(me))];
      break;
    case 'allies':
    case 'strongest_ally':
    case 'weakest_ally':
      cards = charactersOf(s, me).filter((c) => c.uid !== src.uid);
      break;
    case 'all_mine':
      cards = boardOf(s, me);
      break;
    case 'enemies':
    case 'strongest_enemy':
    case 'weakest_enemy':
    case 'random_enemy':
      cards = charactersOf(s, other(me));
      break;
    case 'battle_target': {
      const c = s.battle ? s.cards[s.battle.target] : undefined;
      cards = c ? [c] : [];
      break;
    }
    case 'attacker': {
      const c = s.battle ? s.cards[s.battle.attacker] : undefined;
      cards = c ? [c] : [];
      break;
    }
  }
  return cards.filter((c) => matchesFilter(ctx, s, c, filter));
}
