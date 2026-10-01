import { getCardDef, type MatchContext } from './context.js';
import { boardOf, candidateTargets, evalAmount, evalCondition, isTrending } from './query.js';
import { PLAYERS, STATIC_SELECTORS, type CardInstance, type MatchState } from './types.js';

export type PowerMap = Record<string, number>;

/** Puissance « propre » d'une carte, hors auras d'autres cartes. */
function basePower(ctx: MatchContext, s: MatchState, c: CardInstance): number {
  let v = getCardDef(ctx, c.defId).power + c.permMod + c.turnMod + c.battleMod;
  if (s.active === c.controller) v += c.buzz * ctx.rules.buzzPower;
  if (isTrending(s, c)) v += ctx.rules.keywords.tendance.bonus;
  return v;
}

/**
 * Puissance effective des Leaders et Personnages en jeu :
 * imprimée + modifications (permanentes, du tour, du combat) + Buzz attachés
 * (pendant le tour de son contrôleur) + Tendance + auras continues.
 */
export function computePowers(ctx: MatchContext, s: MatchState): PowerMap {
  const out: PowerMap = {};
  const all = PLAYERS.flatMap((p) => boardOf(s, p));
  for (const c of all) out[c.uid] = basePower(ctx, s, c);

  for (const src of all) {
    if (src.effectsCancelled) continue;
    for (const eff of getCardDef(ctx, src.defId).effects) {
      if (eff.trigger !== 'continuous' || eff.action.type !== 'add_power') continue;
      if (!STATIC_SELECTORS.includes(eff.action.target)) continue;
      const source = { uid: src.uid, controller: src.controller };
      if (eff.condition && !evalCondition(ctx, s, source, eff.condition)) continue;
      const amount = evalAmount(ctx, s, source, eff.action.amount);
      for (const t of candidateTargets(ctx, s, source, eff.action.target, eff.action.filter)) {
        if (t.uid in out) out[t.uid] = (out[t.uid] as number) + amount;
      }
    }
  }
  return out;
}

export function powerOf(ctx: MatchContext, s: MatchState, uid: string): number {
  return computePowers(ctx, s)[uid] ?? 0;
}
