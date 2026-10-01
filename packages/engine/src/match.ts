import { ko, runEffect, runEffects } from './actions.js';
import { getCardDef, type MatchContext } from './context.js';
import { EngineError } from './errors.js';
import { onAttackKeywords, onPlayKeywords } from './keywords.js';
import { boardOf, charactersOf, hasKeyword, leaderOf } from './query.js';
import { Resolver } from './resolver.js';
import { Rng } from './rng.js';
import {
  other,
  PLAYERS,
  type CardInstance,
  type GameAction,
  type MatchEndReason,
  type MatchSetup,
  type MatchState,
  type Phase,
  type PlayerIndex,
  type PlayerState,
  type StepResult,
} from './types.js';
import { validateDeck } from './validate.js';

/** L'état est du JSON pur : le clonage par sérialisation garantit aussi qu'il le reste. */
export function cloneState(s: MatchState): MatchState {
  return JSON.parse(JSON.stringify(s)) as MatchState;
}

/** Les effets peuvent terminer la partie : on relit la phase sans rétrécissement de type. */
const isEnded = (s: MatchState): boolean => s.phase === 'ended';

const illegal = (message: string): never => {
  throw new EngineError('illegal_action', message);
};

// ---------------------------------------------------------------------------
// Qui doit décider ?
// ---------------------------------------------------------------------------

export interface Decision {
  player: PlayerIndex;
  kind: Exclude<Phase, 'ended'>;
}

export function pendingDecision(s: MatchState): Decision | null {
  switch (s.phase) {
    case 'mulligan':
      return s.mulliganPending[0] !== undefined ? { player: s.mulliganPending[0], kind: 'mulligan' } : null;
    case 'main':
      return { player: s.active, kind: 'main' };
    case 'block':
    case 'counter':
      return s.battle ? { player: other(s.battle.attackerPlayer), kind: s.phase } : null;
    case 'trigger':
      return s.damage ? { player: s.damage.player, kind: 'trigger' } : null;
    case 'ended':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Règles de légalité (partagées par la validation et `legalActions`)
// ---------------------------------------------------------------------------

function isOwnBoardCard(s: MatchState, player: PlayerIndex, c: CardInstance | undefined): c is CardInstance {
  return !!c && c.controller === player && (c.zone === 'field' || c.zone === 'leader');
}

export function canPlay(ctx: MatchContext, s: MatchState, player: PlayerIndex, uid: string): boolean {
  const c = s.cards[uid];
  if (s.phase !== 'main' || s.active !== player || !c || c.zone !== 'hand' || c.controller !== player) return false;
  const def = getCardDef(ctx, c.defId);
  const p = s.players[player];
  if (def.cost > p.buzzActive) return false;
  if (def.type === 'character') return p.characters.length < ctx.rules.maxCharacters;
  if (def.type === 'event') return def.effects.some((e) => e.trigger === 'main');
  return false;
}

export function canAttackWith(ctx: MatchContext, s: MatchState, player: PlayerIndex, uid: string): boolean {
  const c = s.cards[uid];
  if (s.phase !== 'main' || s.active !== player || !isOwnBoardCard(s, player, c) || c.rested) return false;
  if (ctx.rules.noAttackOnFirstTurn && s.turn <= 2) return false;
  if (c.zone === 'field' && c.playedTurn === s.turn && !hasKeyword(ctx, c, 'elan')) return false;
  return true;
}

export function attackTargets(s: MatchState, player: PlayerIndex): string[] {
  const enemy = other(player);
  return [s.players[enemy].leader, ...charactersOf(s, enemy).filter((c) => c.rested).map((c) => c.uid)];
}

export function canActivate(ctx: MatchContext, s: MatchState, player: PlayerIndex, uid: string): boolean {
  const c = s.cards[uid];
  if (s.phase !== 'main' || s.active !== player || !isOwnBoardCard(s, player, c) || c.effectsCancelled) return false;
  if (c.activatedTurn === s.turn) return false;
  const effect = getCardDef(ctx, c.defId).effects.find((e) => e.trigger === 'activate_main');
  return !!effect && (effect.buzzCost ?? 0) <= s.players[player].buzzActive;
}

export function blockersOf(ctx: MatchContext, s: MatchState, player: PlayerIndex): string[] {
  return charactersOf(s, player)
    .filter((c) => !c.rested && hasKeyword(ctx, c, 'bloqueur') && c.uid !== s.battle?.target)
    .map((c) => c.uid);
}

export interface CounterOption {
  uid: string;
  /** Valeur de Contre d'un Personnage (0 pour un Événement). */
  value: number;
  /** Coût en Buzz (Événements). */
  cost: number;
  event: boolean;
}

export function counterOptions(ctx: MatchContext, s: MatchState, player: PlayerIndex): CounterOption[] {
  const p = s.players[player];
  const out: CounterOption[] = [];
  for (const uid of p.hand) {
    const def = getCardDef(ctx, s.cards[uid]!.defId);
    if (def.type === 'character' && (def.counter ?? 0) > 0) out.push({ uid, value: def.counter ?? 0, cost: 0, event: false });
    if (def.type === 'event' && def.effects.some((e) => e.trigger === 'counter') && def.cost <= p.buzzActive) {
      out.push({ uid, value: 0, cost: def.cost, event: true });
    }
  }
  return out;
}

export function canDeclareHype(ctx: MatchContext, s: MatchState, player: PlayerIndex): boolean {
  return s.phase === 'main' && s.active === player && !s.players[player].hypeDeclared && s.stake < ctx.rules.hype.maxStake;
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

const newPlayer = (id: string): PlayerState => ({
  id,
  leader: '',
  deck: [],
  hand: [],
  life: [],
  characters: [],
  trash: [],
  buzzDeck: 0,
  buzzActive: 0,
  buzzRested: 0,
  hypeDeclared: false,
});

export function createMatch(ctx: MatchContext, setup: MatchSetup): StepResult {
  for (const p of PLAYERS) {
    const errors = validateDeck(ctx, setup.players[p].leader, setup.players[p].deck);
    if (errors.length) throw new EngineError('invalid_deck', `Deck invalide (joueur ${p})`, { player: p, errors });
  }

  const s: MatchState = {
    version: 2,
    seed: setup.seed,
    rng: Rng.fromSeed(setup.seed).getState(),
    turn: 0,
    first: 0,
    active: 0,
    phase: 'mulligan',
    mulliganPending: [],
    players: [newPlayer(setup.players[0].id), newPlayer(setup.players[1].id)],
    cards: {},
    nextUid: 0,
    battle: null,
    damage: null,
    stake: ctx.rules.hype.baseStake,
    trending: [...(setup.trendingCardIds ?? [])],
    result: null,
  };
  const r = new Resolver(ctx, s);
  s.first = setup.first ?? (r.rng.int(2) as PlayerIndex);
  s.active = s.first;

  for (const p of PLAYERS) {
    const player = s.players[p];
    player.leader = r.createInstance(setup.players[p].leader, p, 'leader', false).uid;
    player.buzzDeck = ctx.rules.buzzTotal;
    const deck = setup.players[p].deck.map((id) => r.createInstance(id, p, 'deck', false).uid);
    player.deck = setup.shuffleDecks === false ? deck : r.rng.shuffle(deck);
  }
  for (const p of PLAYERS) for (let i = 0; i < ctx.rules.startingHand; i++) r.draw(p);

  if (setup.skipMulligan) startGame(r);
  else s.mulliganPending = [s.first, other(s.first)];

  r.commit();
  return { state: s, events: r.events };
}

/** Après les mulligans : on pose les Vies, puis premier tour. */
function startGame(r: Resolver): void {
  for (const p of PLAYERS) {
    const life = getCardDef(r.ctx, leaderOf(r.s, p).defId).life ?? 0;
    for (let i = 0; i < life; i++) {
      const uid = r.s.players[p].deck[0];
      if (uid) r.moveTo(r.card(uid), 'life', p);
    }
    r.emit({ type: 'life_set', player: p, count: r.s.players[p].life.length });
  }
  startTurn(r);
}

// ---------------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------------

function endGame(r: Resolver, winner: PlayerIndex | null, reason: MatchEndReason): void {
  const s = r.s;
  if (s.phase === 'ended') return;
  s.phase = 'ended';
  s.battle = null;
  s.damage = null;
  s.result = {
    winner,
    reason: winner === null && reason !== 'turn_limit' ? 'draw' : reason,
    stake: s.stake,
    life: [s.players[0].life.length, s.players[1].life.length],
    turns: s.turn,
  };
  r.emit({ type: 'match_ended', result: s.result });
}

function startTurn(r: Resolver): void {
  const { s, ctx } = r;
  s.turn += 1;
  if (s.turn > ctx.rules.maxTurns) {
    const [a, b] = [s.players[0].life.length, s.players[1].life.length];
    endGame(r, a === b ? null : a > b ? 0 : 1, 'turn_limit');
    return;
  }
  s.active = s.turn % 2 === 1 ? s.first : other(s.first);
  const p = s.players[s.active];
  s.phase = 'main';
  r.emit({ type: 'turn_started', turn: s.turn, player: s.active });

  // Redressement : tout redevient actif, les Buzz attachés reviennent.
  for (const c of boardOf(s, s.active)) {
    c.rested = false;
    p.buzzRested += c.buzz;
    c.buzz = 0;
  }
  p.buzzActive += p.buzzRested;
  p.buzzRested = 0;
  r.emit({ type: 'refreshed', player: s.active });

  // Pioche (sauf le premier joueur à son premier tour). Pioche vide = défaite.
  if (!(s.turn === 1 && ctx.rules.firstPlayerSkipsDraw)) {
    if (!r.draw(s.active)) {
      endGame(r, other(s.active), 'deck_out');
      return;
    }
  }

  r.gainBuzz(s.active, s.turn === 1 ? ctx.rules.buzzFirstTurn : ctx.rules.buzzPerTurn, false);
}

function endTurn(r: Resolver): void {
  const { s, ctx } = r;
  const player = s.active;
  for (const c of boardOf(s, player)) {
    if (c.zone === 'field' && hasKeyword(ctx, c, 'croissance')) {
      r.emit({ type: 'keyword_triggered', uid: c.uid, keyword: 'croissance', targets: [c.uid] });
      r.addPower(c.uid, ctx.rules.keywords.croissance.perTurn, 'permanent', c.uid);
    }
    if (c.zone === 'field' || c.zone === 'leader') runEffects(r, c, 'end_of_turn');
    if (s.phase === 'ended') return;
  }
  for (const p of PLAYERS) for (const c of boardOf(s, p)) c.turnMod = 0;
  r.emit({ type: 'turn_ended', turn: s.turn, player });
  startTurn(r);
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

function goToDefense(r: Resolver): void {
  const { s, ctx } = r;
  if (!s.battle) return;
  const defender = other(s.battle.attackerPlayer);
  if (blockersOf(ctx, s, defender).length > 0) s.phase = 'block';
  else goToCounter(r);
}

function goToCounter(r: Resolver): void {
  const { s, ctx } = r;
  if (!s.battle) return;
  if (counterOptions(ctx, s, other(s.battle.attackerPlayer)).length > 0) s.phase = 'counter';
  else resolveBattle(r);
}

function endBattle(r: Resolver): void {
  const s = r.s;
  for (const p of PLAYERS) for (const c of boardOf(s, p)) c.battleMod = 0;
  s.battle = null;
  if (s.phase !== 'ended') s.phase = 'main';
}

function resolveBattle(r: Resolver): void {
  const { s, ctx } = r;
  const b = s.battle;
  if (!b) return;
  const attacker = r.card(b.attacker);
  const target = r.card(b.target);
  const onBoard = (c: CardInstance) => c.zone === 'field' || c.zone === 'leader';
  if (!onBoard(attacker) || !onBoard(target)) {
    endBattle(r);
    return;
  }
  const powers = r.powers();
  const attackerPower = powers[attacker.uid] ?? 0;
  const defenderPower = powers[target.uid] ?? 0;
  const hit = attackerPower >= defenderPower;
  r.emit({ type: 'battle_resolved', attacker: attacker.uid, target: target.uid, attackerPower, defenderPower, hit });
  if (!hit) {
    endBattle(r);
    return;
  }
  if (target.zone === 'field') {
    ko(r, target.uid, attacker.uid);
    endBattle(r);
    return;
  }
  const damage = hasKeyword(ctx, attacker, 'viral') ? ctx.rules.keywords.viral.damage : 1;
  if (damage > 1) r.emit({ type: 'keyword_triggered', uid: attacker.uid, keyword: 'viral', targets: [target.uid] });
  const banish = hasKeyword(ctx, attacker, 'ratio');
  if (banish) r.emit({ type: 'keyword_triggered', uid: attacker.uid, keyword: 'ratio', targets: [target.uid] });
  s.damage = { player: target.controller, remaining: damage, banish, trigger: null };
  processDamage(r);
}

/** Retire les Vies une par une. Une carte Vie avec [Déclencheur] attend la décision de son propriétaire. */
function processDamage(r: Resolver): void {
  const { s } = r;
  const d = s.damage;
  if (!d) return;
  while (d.remaining > 0) {
    const p = s.players[d.player];
    const top = p.life[0];
    if (!top) {
      endGame(r, other(d.player), 'life');
      return;
    }
    d.remaining -= 1;
    const c = r.card(top);
    if (d.banish) {
      r.moveTo(c, 'trash');
      r.emit({ type: 'life_lost', player: d.player, uid: top, to: 'trash', remaining: p.life.length });
      continue;
    }
    if (r.defOf(c).effects.some((e) => e.trigger === 'on_trigger')) {
      d.trigger = top;
      s.phase = 'trigger';
      r.emit({ type: 'trigger_revealed', player: d.player, uid: top, defId: c.defId });
      return;
    }
    r.moveTo(c, 'hand');
    r.emit({ type: 'life_lost', player: d.player, uid: top, to: 'hand', remaining: p.life.length });
  }
  s.damage = null;
  endBattle(r);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function pay(r: Resolver, player: PlayerIndex, amount: number): void {
  if (amount <= 0) return;
  const p = r.s.players[player];
  p.buzzActive -= amount;
  p.buzzRested += amount;
  r.emit({ type: 'buzz_spent', player, amount });
}

function play(r: Resolver, player: PlayerIndex, uid: string): void {
  const { s, ctx } = r;
  if (!canPlay(ctx, s, player, uid)) illegal('Carte injouable.');
  const c = r.card(uid);
  const def = r.defOf(c);
  pay(r, player, def.cost);
  if (def.type === 'character') {
    r.moveTo(c, 'field', player);
    c.playedTurn = s.turn;
    r.emit({ type: 'card_played', player, uid, defId: c.defId, cardType: def.type });
    onPlayKeywords(r, c);
    if (c.zone === 'field') runEffects(r, c, 'on_play');
  } else {
    r.moveTo(c, 'trash');
    r.emit({ type: 'card_played', player, uid, defId: c.defId, cardType: def.type });
    for (const e of def.effects) if (e.trigger === 'main') runEffect(r, { ...c, controller: player }, e);
  }
}

function attack(r: Resolver, player: PlayerIndex, attackerUid: string, targetUid: string): void {
  const { s, ctx } = r;
  if (!canAttackWith(ctx, s, player, attackerUid)) illegal('Cette carte ne peut pas attaquer.');
  if (!attackTargets(s, player).includes(targetUid)) illegal('Cible invalide : le Leader adverse ou un Personnage épuisé.');
  const attacker = r.card(attackerUid);
  attacker.rested = true;
  s.battle = { attacker: attackerUid, attackerPlayer: player, target: targetUid, declaredTarget: targetUid, blocked: false };
  r.emit({ type: 'attack_declared', attacker: attackerUid, target: targetUid, player });
  onAttackKeywords(r, attacker);
  runEffects(r, attacker, 'on_attack');
  if (s.phase === 'ended') return;
  goToDefense(r);
}

function block(r: Resolver, player: PlayerIndex, blocker: string | null): void {
  const { s, ctx } = r;
  const b = s.battle!;
  if (blocker !== null) {
    if (!blockersOf(ctx, s, player).includes(blocker)) illegal('Ce Personnage ne peut pas bloquer.');
    r.card(blocker).rested = true;
    b.target = blocker;
    b.blocked = true;
    r.emit({ type: 'blocked', blocker, player });
  }
  goToCounter(r);
}

function counter(r: Resolver, player: PlayerIndex, uids: string[]): void {
  const { s, ctx } = r;
  const options = counterOptions(ctx, s, player);
  const unique = [...new Set(uids)];
  const chosen = unique.map((uid) => options.find((o) => o.uid === uid) ?? illegal(`Contre impossible : ${uid}`));
  if (chosen.reduce((sum, o) => sum + o.cost, 0) > s.players[player].buzzActive) illegal('Pas assez de Buzz pour ces contres.');

  for (const option of chosen) {
    if (s.phase === 'ended' || !s.battle) return;
    const c = r.card(option.uid);
    const def = r.defOf(c);
    r.moveTo(c, 'trash');
    r.emit({ type: 'counter_played', player, uid: c.uid, defId: c.defId, value: option.value });
    if (!option.event) {
      r.addPower(s.battle.target, option.value, 'battle', c.uid);
    } else {
      pay(r, player, option.cost);
      for (const e of def.effects) if (e.trigger === 'counter') runEffect(r, { ...c, controller: player }, e);
    }
  }
  resolveBattle(r);
}

function trigger(r: Resolver, player: PlayerIndex, activate: boolean): void {
  const { s } = r;
  const d = s.damage!;
  const c = r.card(d.trigger!);
  d.trigger = null;
  if (activate) {
    r.moveTo(c, 'trash');
    r.emit({ type: 'life_lost', player, uid: c.uid, to: 'trash', remaining: s.players[player].life.length });
    r.emit({ type: 'trigger_resolved', player, uid: c.uid, activated: true });
    for (const e of r.defOf(c).effects) {
      if (e.trigger === 'on_trigger' && !isEnded(s)) runEffect(r, { ...c, controller: player }, e);
    }
  } else {
    r.moveTo(c, 'hand');
    r.emit({ type: 'life_lost', player, uid: c.uid, to: 'hand', remaining: s.players[player].life.length });
    r.emit({ type: 'trigger_resolved', player, uid: c.uid, activated: false });
  }
  if (isEnded(s)) return;
  processDamage(r);
}

function mulligan(r: Resolver, player: PlayerIndex, redraw: boolean): void {
  const { s, ctx } = r;
  if (redraw) {
    const p = s.players[player];
    for (const uid of [...p.hand]) r.moveTo(r.card(uid), 'deck', player);
    r.rng.shuffle(p.deck);
    for (let i = 0; i < ctx.rules.startingHand; i++) r.draw(player);
  }
  r.emit({ type: 'mulligan', player, redraw });
  s.mulliganPending.shift();
  if (s.mulliganPending.length === 0) startGame(r);
}

/**
 * Applique l'action d'un joueur. L'état d'entrée n'est jamais modifié.
 * Lève une `EngineError` si l'action est illégale ou si ce n'est pas à ce joueur de décider.
 */
export function applyAction(ctx: MatchContext, state: MatchState, player: PlayerIndex, action: GameAction): StepResult {
  if (state.phase === 'ended') throw new EngineError('match_ended', 'La partie est terminée.');
  const decision = pendingDecision(state);
  if (action.type !== 'fold' && decision?.player !== player) {
    throw new EngineError('not_your_decision', "Ce n'est pas à ce joueur de décider.");
  }

  const s = cloneState(state);
  const r = new Resolver(ctx, s);
  const kind = decision?.kind;
  const requireKind = (k: Phase) => {
    if (kind !== k) illegal(`Action impossible pendant la phase « ${kind} ».`);
  };

  switch (action.type) {
    case 'mulligan':
      requireKind('mulligan');
      mulligan(r, player, action.redraw);
      break;
    case 'play':
      requireKind('main');
      play(r, player, action.uid);
      break;
    case 'attach': {
      requireKind('main');
      const amount = action.amount ?? 1;
      const c = s.cards[action.target];
      if (!isOwnBoardCard(s, player, c)) illegal('On attache le Buzz à son Leader ou à ses Personnages.');
      if (!Number.isInteger(amount) || amount < 1 || amount > s.players[player].buzzActive) illegal('Pas assez de Buzz actif.');
      s.players[player].buzzActive -= amount;
      c!.buzz += amount;
      r.emit({ type: 'buzz_attached', player, target: action.target, amount });
      break;
    }
    case 'attack':
      requireKind('main');
      attack(r, player, action.attacker, action.target);
      break;
    case 'activate': {
      requireKind('main');
      if (!canActivate(ctx, s, player, action.uid)) illegal('Activation impossible.');
      const c = r.card(action.uid);
      const effect = r.defOf(c).effects.find((e) => e.trigger === 'activate_main')!;
      pay(r, player, effect.buzzCost ?? 0);
      c.activatedTurn = s.turn;
      runEffect(r, c, effect);
      break;
    }
    case 'end_turn':
      requireKind('main');
      endTurn(r);
      break;
    case 'block':
      requireKind('block');
      block(r, player, action.blocker);
      break;
    case 'counter':
      requireKind('counter');
      counter(r, player, action.uids);
      break;
    case 'trigger':
      requireKind('trigger');
      trigger(r, player, action.activate);
      break;
    case 'hype': {
      if (!canDeclareHype(ctx, s, player)) illegal('Hype indisponible.');
      s.players[player].hypeDeclared = true;
      s.stake = Math.min(ctx.rules.hype.maxStake, s.stake * ctx.rules.hype.multiplier);
      r.emit({ type: 'hype_declared', player });
      r.emit({ type: 'stake_changed', stake: s.stake });
      break;
    }
    case 'fold':
      endGame(r, other(player), 'fold');
      break;
    default:
      action satisfies never;
  }

  r.commit();
  return { state: s, events: r.events };
}

// ---------------------------------------------------------------------------
// Actions légales (pour l'UI et l'IA)
// ---------------------------------------------------------------------------

export interface LegalActions {
  player: PlayerIndex;
  kind: Decision['kind'];
  playable: string[];
  /** Cartes qui peuvent recevoir du Buzz (vide si aucun Buzz actif). */
  attachTargets: string[];
  attackers: { uid: string; targets: string[] }[];
  activatable: string[];
  blockers: string[];
  counters: CounterOption[];
  canHype: boolean;
}

export function legalActions(ctx: MatchContext, s: MatchState, player: PlayerIndex): LegalActions | null {
  const d = pendingDecision(s);
  if (!d || d.player !== player) return null;
  const main = d.kind === 'main';
  const p = s.players[player];
  const own = boardOf(s, player);
  const targets = attackTargets(s, player);
  return {
    player,
    kind: d.kind,
    playable: main ? p.hand.filter((uid) => canPlay(ctx, s, player, uid)) : [],
    attachTargets: main && p.buzzActive > 0 ? own.map((c) => c.uid) : [],
    attackers: main
      ? own.filter((c) => canAttackWith(ctx, s, player, c.uid)).map((c) => ({ uid: c.uid, targets }))
      : [],
    activatable: main ? own.filter((c) => canActivate(ctx, s, player, c.uid)).map((c) => c.uid) : [],
    blockers: d.kind === 'block' ? blockersOf(ctx, s, player) : [],
    counters: d.kind === 'counter' ? counterOptions(ctx, s, player) : [],
    canHype: canDeclareHype(ctx, s, player),
  };
}

