import { getCardDef, type MatchContext } from './context.js';
import { legalActions, type LegalActions } from './match.js';
import { computePowers } from './power.js';
import { candidateTargets, hasKeyword, leaderOf } from './query.js';
import type { Rng } from './rng.js';
import { other, type Action, type CardDef, type GameAction, type MatchState, type PlayerIndex } from './types.js';

/**
 * IA simple et gloutonne, une action à la fois. Elle ne lit que des informations
 * auxquelles un joueur a droit : sa main, son état, et le plateau public.
 * Utilisée par le prototype local et, plus tard, par le mode fantôme.
 */
export function chooseAction(ctx: MatchContext, s: MatchState, player: PlayerIndex, rng?: Rng): GameAction | null {
  const legal = legalActions(ctx, s, player);
  if (!legal) return null;
  switch (legal.kind) {
    case 'mulligan':
      return { type: 'mulligan', redraw: wantsMulligan(ctx, s, player) };
    case 'main':
      return chooseMain(ctx, s, player, legal, rng);
    case 'block':
      return { type: 'block', blocker: chooseBlocker(ctx, s, player, legal) };
    case 'counter':
      return { type: 'counter', uids: chooseCounters(ctx, s, player, legal) };
    case 'trigger':
      return { type: 'trigger', activate: true };
  }
}

function wantsMulligan(ctx: MatchContext, s: MatchState, player: PlayerIndex): boolean {
  return !s.players[player].hand.some((uid) => {
    const def = getCardDef(ctx, s.cards[uid]!.defId);
    return def.type === 'character' && def.cost <= 2;
  });
}

/** Valeur d'un effet « Jouée » / « Principale » dans la situation actuelle (0 = inutile). */
function actionValue(ctx: MatchContext, s: MatchState, player: PlayerIndex, a: Action): number {
  const src = { uid: null, controller: player };
  if ('target' in a && a.type !== 'add_power') {
    const pool = candidateTargets(ctx, s, src, a.target, a.filter);
    if (pool.length === 0) return 0;
    if (a.type === 'ko' || a.type === 'steal' || a.type === 'bounce') return 4;
    return 2;
  }
  switch (a.type) {
    case 'add_power':
      return typeof a.amount === 'number' ? Math.max(0, a.amount) : 2;
    case 'draw':
      return 2 * a.amount;
    case 'add_card_to_hand':
    case 'add_buzz':
      return 2;
    case 'discard':
      return a.side === 'enemy' ? 2 : 0;
    case 'random_of':
      return 2;
    default:
      return 1;
  }
}

function cardScore(ctx: MatchContext, s: MatchState, player: PlayerIndex, def: CardDef): number {
  if (def.type === 'event') {
    return def.effects.filter((e) => e.trigger === 'main').reduce((sum, e) => sum + actionValue(ctx, s, player, e.action), 0);
  }
  const lowLife = s.players[player].life.length <= 2;
  let score = def.power + def.cost * 0.5;
  if (def.keywords.includes('bloqueur') && lowLife) score += 3;
  if (def.keywords.includes('elan')) score += 1;
  for (const e of def.effects) if (e.trigger === 'on_play') score += actionValue(ctx, s, player, e.action);
  return score;
}

function chooseMain(ctx: MatchContext, s: MatchState, player: PlayerIndex, legal: LegalActions, rng?: Rng): GameAction {
  const enemy = other(player);
  const me = s.players[player];

  if (legal.canHype && s.players[enemy].life.length <= 1 && me.life.length >= 3) return { type: 'hype' };

  // 1. Jouer la carte la plus rentable (les plus chères d'abord).
  let best: { uid: string; score: number } | null = null;
  for (const uid of legal.playable) {
    const def = getCardDef(ctx, s.cards[uid]!.defId);
    const noise = rng ? rng.int(100) / 200 : 0;
    const score = cardScore(ctx, s, player, def) + noise;
    if (score > 0.5 && (!best || score > best.score)) best = { uid, score };
  }
  if (best) return { type: 'play', uid: best.uid };

  // 2. Capacités activables.
  const activatable = legal.activatable[0];
  if (activatable) return { type: 'activate', uid: activatable };

  // 3. Attaques : KO d'un Personnage épuisé si possible, sinon le Leader adverse.
  const powers = computePowers(ctx, s);
  const enemyLeader = leaderOf(s, enemy);
  const leaderPower = powers[enemyLeader.uid] ?? 0;
  const attackers = [...legal.attackers].sort((a, b) => (powers[b.uid] ?? 0) - (powers[a.uid] ?? 0));
  for (const { uid, targets } of attackers) {
    const p = powers[uid] ?? 0;
    const koTargets = targets
      .filter((t) => t !== enemyLeader.uid && (powers[t] ?? 0) <= p)
      .sort((a, b) => getCardDef(ctx, s.cards[b]!.defId).cost - getCardDef(ctx, s.cards[a]!.defId).cost);
    const valuable = koTargets.find((t) => getCardDef(ctx, s.cards[t]!.defId).cost >= 3);
    if (valuable) return { type: 'attack', attacker: uid, target: valuable };
    // Marge de sécurité contre les contres : viser +1 au-dessus si on a du Buzz.
    const want = leaderPower + (me.buzzActive > 0 ? 1 : 0);
    if (p < want && legal.attachTargets.includes(uid) && want - p <= me.buzzActive) {
      return { type: 'attach', target: uid, amount: want - p };
    }
    if (p >= leaderPower) return { type: 'attack', attacker: uid, target: enemyLeader.uid };
    const anyKo = koTargets[0];
    if (anyKo) return { type: 'attack', attacker: uid, target: anyKo };
  }

  return { type: 'end_turn' };
}

function chooseBlocker(ctx: MatchContext, s: MatchState, player: PlayerIndex, legal: LegalActions): string | null {
  const b = s.battle!;
  const powers = computePowers(ctx, s);
  const attackerPower = powers[b.attacker] ?? 0;
  const lowLife = s.players[player].life.length <= 2;
  const targetIsLeader = s.cards[b.target]?.zone === 'leader';
  const survivors = legal.blockers.filter((uid) => (powers[uid] ?? 0) > attackerPower);
  if (survivors[0]) return survivors[0];
  if (targetIsLeader && lowLife) {
    // Sacrifice du Bloqueur le moins cher.
    return [...legal.blockers].sort((a, c) => getCardDef(ctx, s.cards[a]!.defId).cost - getCardDef(ctx, s.cards[c]!.defId).cost)[0] ?? null;
  }
  return null;
}

/** Contres minimaux pour survivre, seulement si l'enjeu en vaut la peine. */
function chooseCounters(ctx: MatchContext, s: MatchState, player: PlayerIndex, legal: LegalActions): string[] {
  const b = s.battle!;
  const powers = computePowers(ctx, s);
  const need = (powers[b.attacker] ?? 0) - (powers[b.target] ?? 0) + 1;
  if (need <= 0) return [];
  const target = s.cards[b.target]!;
  const life = s.players[player].life.length;
  const handSize = s.players[player].hand.length;
  const worth =
    target.zone === 'leader'
      ? life <= 2 || (need <= 1 && handSize >= 4) || hasKeyword(ctx, s.cards[b.attacker]!, 'viral')
      : getCardDef(ctx, target.defId).cost >= 4 && need <= 2;
  if (!worth) return [];

  const options = legal.counters
    .map((o) => {
      if (!o.event) return { uid: o.uid, value: o.value, cost: 0 };
      const effect = getCardDef(ctx, s.cards[o.uid]!.defId).effects.find((e) => e.trigger === 'counter');
      const value = effect?.action.type === 'add_power' && typeof effect.action.amount === 'number' ? effect.action.amount : 0;
      return { uid: o.uid, value, cost: o.cost };
    })
    .filter((o) => o.value > 0)
    .sort((a, c) => a.value - c.value || a.cost - c.cost);

  const picked: string[] = [];
  let total = 0;
  let buzz = s.players[player].buzzActive;
  for (const o of options) {
    if (total >= need) break;
    if (o.cost > buzz) continue;
    picked.push(o.uid);
    total += o.value;
    buzz -= o.cost;
  }
  return total >= need ? picked : [];
}
