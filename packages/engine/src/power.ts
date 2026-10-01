import { getCardDef, type MatchContext } from './context.js';
import {
  activeTerrainDef,
  evalAmount,
  evalCondition,
  isTrending,
  matchesFilter,
  revealedOn,
  staticTargets,
} from './query.js';
import { PLAYERS, type MatchResult, type MatchState, type PlayerIndex } from './types.js';

export type PowerMap = Record<string, number>;

/**
 * Puissance effective de chaque carte révélée sur le plateau :
 * base + modifications permanentes + Clickbait + Tendance + terrain + auras continues.
 * Les auras ne dépendent jamais de la puissance (pas de circularité).
 */
export function computePowers(ctx: MatchContext, s: MatchState): PowerMap {
  const out: PowerMap = {};
  const add = (uid: string, v: number) => {
    if (uid in out) out[uid] = (out[uid] as number) + v;
  };

  s.terrains.forEach((_, ti) => {
    const tdef = activeTerrainDef(ctx, s, ti);
    for (const p of PLAYERS) {
      for (const c of revealedOn(s, ti, p)) {
        let v = c.powerBase + c.powerMod;
        if (isTrending(s, c)) v += ctx.rules.keywords.tendance.bonus;
        if (c.clickbaitUntilTurn !== null) v += ctx.rules.keywords.clickbait.bonus;
        if (tdef) {
          for (const m of tdef.modifiers) {
            if (m.type === 'power' && matchesFilter(ctx, s, c, m.filter)) v += m.amount;
          }
          if (tdef.favoredCountry && getCardDef(ctx, c.defId).country === tdef.favoredCountry) {
            v += ctx.rules.countryTerrainBonus;
          }
        }
        out[c.uid] = v;
      }
    }
  });

  s.terrains.forEach((_, ti) => {
    const tdef = activeTerrainDef(ctx, s, ti);
    for (const p of PLAYERS) {
      for (const c of revealedOn(s, ti, p)) {
        const src = { uid: c.uid, controller: p, terrain: ti };

        if (tdef) {
          for (const m of tdef.modifiers) {
            if (m.type !== 'aura' || !matchesFilter(ctx, s, c, m.filter)) continue;
            for (const ally of staticTargets(ctx, s, src, 'allies_here', undefined, undefined)) add(ally.uid, m.amount);
          }
        }

        if (c.effectsCancelled || c.continuousCancelled) continue;
        for (const eff of getCardDef(ctx, c.defId).effects) {
          if (eff.trigger !== 'continuous' || eff.action.type !== 'add_power') continue;
          if (eff.condition && !evalCondition(ctx, s, src, eff.condition)) continue;
          const amount = evalAmount(ctx, s, src, eff.action.amount);
          for (const t of staticTargets(ctx, s, src, eff.action.target, eff.action.filter, eff.action.side)) {
            add(t.uid, amount);
          }
        }
      }
    }
  });

  return out;
}

export function terrainPowers(ctx: MatchContext, s: MatchState, powers = computePowers(ctx, s)): [number, number][] {
  return s.terrains.map((_, ti) => {
    const sum = (p: PlayerIndex) => revealedOn(s, ti, p).reduce((acc, c) => acc + (powers[c.uid] ?? 0), 0);
    return [sum(0), sum(1)];
  });
}

export interface Standing {
  terrainPowers: [number, number][];
  controllers: (PlayerIndex | null)[];
  controlled: [number, number];
  totalPower: [number, number];
}

export function computeStanding(ctx: MatchContext, s: MatchState): Standing {
  const tp = terrainPowers(ctx, s);
  const controllers = tp.map(([a, b]) => (a > b ? 0 : b > a ? 1 : null));
  const controlled: [number, number] = [
    controllers.filter((c) => c === 0).length,
    controllers.filter((c) => c === 1).length,
  ];
  const totalPower: [number, number] = [
    tp.reduce((acc, [a]) => acc + a, 0),
    tp.reduce((acc, [, b]) => acc + b, 0),
  ];
  return { terrainPowers: tp, controllers, controlled, totalPower };
}

/** Le joueur qui mène : plus de terrains contrôlés, puis plus de puissance totale. `null` en cas d'égalité. */
export function computeLeader(ctx: MatchContext, s: MatchState): PlayerIndex | null {
  const { controlled, totalPower } = computeStanding(ctx, s);
  if (controlled[0] !== controlled[1]) return controlled[0] > controlled[1] ? 0 : 1;
  if (totalPower[0] !== totalPower[1]) return totalPower[0] > totalPower[1] ? 0 : 1;
  return null;
}

/** Décompte final : 2 terrains sur 3, sinon puissance totale, sinon match nul. */
export function scoreMatch(ctx: MatchContext, s: MatchState): Omit<MatchResult, 'stake'> {
  const st = computeStanding(ctx, s);
  const need = ctx.rules.terrainsToWin;
  let winner: PlayerIndex | null = null;
  let reason: MatchResult['reason'] = 'draw';
  if (st.controlled[0] >= need) {
    winner = 0;
    reason = 'terrains';
  } else if (st.controlled[1] >= need) {
    winner = 1;
    reason = 'terrains';
  } else if (st.totalPower[0] !== st.totalPower[1]) {
    winner = st.totalPower[0] > st.totalPower[1] ? 0 : 1;
    reason = 'total_power';
  }
  return {
    winner,
    reason,
    terrainPowers: st.terrainPowers,
    controllers: st.controllers,
    totalPower: st.totalPower,
  };
}
