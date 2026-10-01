import { getCardDef, getTerrainDef, type MatchContext } from './context.js';
import { canDeclareHype, validatePlays } from './match.js';
import { manaForTurn, matchesFilter, playCost } from './query.js';
import type { Rng } from './rng.js';
import type { CardInstance, MatchState, Play, PlayerIndex, TargetSelector, TurnSubmission } from './types.js';
import { getPlayerView, type PlayerView } from './view.js';

/**
 * IA simple et gloutonne. Elle ne lit que ce qu'un joueur a le droit de voir :
 * sa main et la vue publique du plateau (`getPlayerView`). Pas de triche.
 * Utilisée par le prototype local et, plus tard, par le mode fantôme.
 */

const ENEMY_SELECTORS: TargetSelector[] = ['enemies_here', 'opposite_card', 'random_enemy_here', 'strongest_enemy_here', 'weakest_enemy_here'];

interface Lane {
  mine: number;
  theirs: number;
  /** Puissances adverses visibles, pour évaluer les effets offensifs. */
  enemyPowers: number[];
  myCount: number;
  slotsLeft: number;
}

function lanes(view: PlayerView, ctx: MatchContext): Lane[] {
  const me = view.you;
  const opp = me === 0 ? 1 : 0;
  return view.terrains.map((t) => ({
    mine: t.power[me],
    theirs: t.power[opp],
    enemyPowers: t.cards[opp].map((c) => c.power ?? 0),
    myCount: t.cards[me].length,
    slotsLeft: ctx.rules.maxCardsPerTerrain - t.cards[me].length,
  }));
}

/** Puissance qu'apporterait la carte sur ce terrain, effets compris (estimation). */
function estimateValue(ctx: MatchContext, s: MatchState, c: CardInstance, terrain: number, lane: Lane): number {
  const def = getCardDef(ctx, c.defId);
  const rules = ctx.rules;
  const k = rules.keywords;
  const turnsLeft = rules.turns - s.turn;
  const tState = s.terrains[terrain];
  const tdef = tState?.revealed ? getTerrainDef(ctx, tState.defId) : null;
  const strongest = Math.max(0, ...lane.enemyPowers);
  const weakest = lane.enemyPowers.length ? Math.min(...lane.enemyPowers) : 0;

  let power = c.powerBase + c.powerMod;
  let swing = 0;
  const has = (kw: string) => def.keywords.includes(kw as never);

  if (s.trending.includes(def.id)) power += k.tendance.bonus;
  if (has('elan') && (s.turn <= k.elan.maxTurn || tdef?.modifiers.some((m) => m.type === 'elan_always'))) power += k.elan.bonus;
  if (has('clickbait')) power += s.turn === rules.turns ? k.clickbait.bonus : 1;
  if (has('croissance')) power += (turnsLeft + 1) * k.croissance.perTurn * 0.8;
  if (has('shitpost')) power += 3;
  if (has('viral')) power += Math.max(0, power - k.viral.powerPenalty) * 0.6;
  if (has('ratio') && lane.enemyPowers.length) swing += Math.min(k.ratio.amount, strongest);
  if (has('rickroll') && lane.enemyPowers.length) swing += strongest;
  if (has('seduction') && lane.enemyPowers.length && lane.slotsLeft > 1) swing += weakest * 2;
  if (has('cancel') && lane.enemyPowers.length) swing += 2;

  if (tdef) {
    for (const m of tdef.modifiers) {
      if (m.type === 'power' && matchesFilter(ctx, s, c, m.filter)) power += m.amount;
      if (m.type === 'aura' && matchesFilter(ctx, s, c, m.filter)) power += m.amount * lane.myCount;
    }
    if (tdef.favoredCountry && def.country === tdef.favoredCountry) power += rules.countryTerrainBonus;
  }

  for (const e of def.effects) {
    const a = e.action;
    const weight = e.condition ? 0.5 : 1;
    if (a.type === 'add_power' && typeof a.amount === 'number') {
      if (a.target === 'self') power += a.amount * weight;
      else if (a.target === 'allies_here') power += a.amount * lane.myCount * weight * (e.trigger === 'continuous' ? 1.5 : 1);
      else if (ENEMY_SELECTORS.includes(a.target) && lane.enemyPowers.length) swing += -a.amount * weight;
      else if (a.target === 'hand') power += a.amount * 2 * weight;
    } else if (a.type === 'add_power' && a.target === 'self') {
      power += lane.myCount * weight;
    } else if ((a.type === 'destroy' || a.type === 'steal') && 'target' in a && ENEMY_SELECTORS.includes(a.target)) {
      if (lane.enemyPowers.length) swing += (a.type === 'steal' ? 2 : 1) * (a.target === 'weakest_enemy_here' ? weakest : strongest) * weight;
    } else if (a.type === 'draw' || a.type === 'add_card_to_hand') {
      power += 1.5 * weight;
    } else if (a.type === 'random_of') {
      power += 2;
    } else if (a.type === 'copy' || a.type === 'transform') {
      power += 2 * weight;
    }
  }
  return power + swing;
}

/** Intérêt d'ajouter `delta` sur un terrain : priorité aux terrains disputés, bonus si on en prend le contrôle. */
function laneGain(lane: Lane, delta: number): number {
  const before = Math.sign(lane.mine - lane.theirs);
  const after = Math.sign(lane.mine + delta - lane.theirs);
  const flip = (after - before) * 4;
  const gap = Math.abs(lane.mine - lane.theirs);
  const weight = gap <= 8 ? 1 : 0.35;
  return delta * weight + flip;
}

export function chooseAiPlays(ctx: MatchContext, s: MatchState, player: PlayerIndex, rng?: Rng): TurnSubmission {
  if (s.phase !== 'planning') return { plays: [] };
  const view = getPlayerView(ctx, s, player);
  const lns = lanes(view, ctx);
  const hand = s.players[player].hand.map((uid) => s.cards[uid]!).filter(Boolean);
  let mana = manaForTurn(ctx, s.turn);
  const plays: Play[] = [];
  const used = new Set<string>();

  for (;;) {
    let best: { play: Play; score: number; value: number; cost: number } | null = null;
    for (const c of hand) {
      if (used.has(c.uid)) continue;
      lns.forEach((lane, t) => {
        if (lane.slotsLeft <= 0) return;
        if (!s.terrains[t]?.revealed && !ctx.rules.allowPlayOnUnrevealedTerrain) return;
        const cost = playCost(ctx, s, c, t);
        if (cost > mana) return;
        const value = estimateValue(ctx, s, c, t, lane);
        const noise = rng ? (rng.int(100) / 100 - 0.5) * 0.8 : 0;
        const score = laneGain(lane, value) + noise;
        if (score > 0 && (!best || score > best.score)) best = { play: { uid: c.uid, terrain: t }, score, value, cost };
      });
    }
    if (!best) break;
    const chosen = best as { play: Play; score: number; value: number; cost: number };
    const lane = lns[chosen.play.terrain]!;
    if (validatePlays(ctx, s, player, { plays: [...plays, chosen.play] }).length > 0) {
      used.add(chosen.play.uid);
      continue;
    }
    plays.push(chosen.play);
    used.add(chosen.play.uid);
    mana -= chosen.cost;
    lane.mine += chosen.value;
    lane.myCount += 1;
    lane.slotsLeft -= 1;
  }
  return { plays };
}

/** Déclare Hype quand l'IA mène nettement sur au moins 2 terrains, à partir du tour 4. */
export function aiWantsHype(ctx: MatchContext, s: MatchState, player: PlayerIndex): boolean {
  if (!canDeclareHype(ctx, s, player) || s.turn < 4) return false;
  const lns = lanes(getPlayerView(ctx, s, player), ctx);
  return lns.filter((l) => l.mine - l.theirs >= 4).length >= 2;
}

/** Lâche au dernier tour si l'enjeu est monté et que la partie semble perdue. */
export function aiWantsFold(ctx: MatchContext, s: MatchState, player: PlayerIndex): boolean {
  if (s.phase !== 'planning' || s.turn < ctx.rules.turns || s.stake < 2) return false;
  const lns = lanes(getPlayerView(ctx, s, player), ctx);
  return lns.filter((l) => l.theirs - l.mine >= 8).length >= 2;
}
