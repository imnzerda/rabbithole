import type { MatchContext } from './context.js';
import { EngineError } from './errors.js';
import { revealCard, runTriggers } from './keywords.js';
import { computeLeader, scoreMatch } from './power.js';
import { manaForTurn, playCost, terrainAt } from './query.js';
import { Resolver } from './resolver.js';
import { Rng } from './rng.js';
import { other, PLAYERS, type MatchSetup, type MatchState, type PlayerIndex, type PlayerState, type StepResult, type TurnSubmission } from './types.js';
import { validateDeck } from './validate.js';

/** L'état est du JSON pur : le clonage par sérialisation garantit aussi qu'il le reste. */
export function cloneState(s: MatchState): MatchState {
  return JSON.parse(JSON.stringify(s)) as MatchState;
}

function assertPlanning(s: MatchState): void {
  if (s.phase !== 'planning') throw new EngineError('match_ended', 'La partie est terminée.');
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

const newPlayer = (id: string): PlayerState => ({ id, deck: [], hand: [], destroyed: [], discarded: [], hypeDeclared: false });

export function createMatch(ctx: MatchContext, setup: MatchSetup): StepResult {
  const rules = ctx.rules;
  for (const p of PLAYERS) {
    const errors = validateDeck(ctx, setup.players[p].deck);
    if (errors.length) throw new EngineError('invalid_deck', `Deck invalide (joueur ${p})`, { player: p, errors });
  }

  const s: MatchState = {
    version: 1,
    seed: setup.seed,
    rng: Rng.fromSeed(setup.seed).getState(),
    turn: 0,
    phase: 'planning',
    players: [newPlayer(setup.players[0].id), newPlayer(setup.players[1].id)],
    terrains: [],
    cards: {},
    nextUid: 0,
    revealFirst: 0,
    revealFirstReason: 'coin_flip',
    stake: rules.hype.baseStake,
    trending: [...(setup.trendingCardIds ?? [])],
    result: null,
  };
  const r = new Resolver(ctx, s);

  let terrainIds: string[];
  if (setup.terrainIds) {
    terrainIds = [...setup.terrainIds];
  } else {
    const pool = [...(setup.terrainPool ?? Object.keys(ctx.terrains))];
    if (pool.length < rules.terrainCount) throw new EngineError('invalid_setup', 'Pas assez de terrains disponibles.');
    terrainIds = r.rng.shuffle(pool).slice(0, rules.terrainCount);
  }
  if (terrainIds.length !== rules.terrainCount) {
    throw new EngineError('invalid_setup', `Il faut exactement ${rules.terrainCount} terrains.`);
  }
  for (const id of terrainIds) {
    if (!ctx.terrains[id]) throw new EngineError('unknown_terrain_def', `Terrain inconnu : ${id}`);
  }
  s.terrains = terrainIds.map((defId) => ({ defId, revealed: false, slots: [[], []] }));

  for (const p of PLAYERS) {
    const deck = setup.players[p].deck.map((id) => r.createInstance(id, p, 'deck', false).uid);
    s.players[p].deck = setup.shuffleDecks === false ? deck : r.rng.shuffle(deck);
  }
  for (const p of PLAYERS) {
    for (let i = 0; i < rules.startingHand; i++) r.draw(p);
  }

  startTurn(r);
  r.commit();
  return { state: s, events: r.events };
}

// ---------------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------------

function raiseStake(r: Resolver, reason: 'hype' | 'final_turn'): void {
  const h = r.ctx.rules.hype;
  const next = Math.min(h.maxStake, r.s.stake * h.multiplier);
  if (next === r.s.stake) return;
  r.s.stake = next;
  r.emit({ type: 'stake_changed', stake: next, reason });
}

function startTurn(r: Resolver): void {
  const { s, ctx } = r;
  s.turn += 1;
  r.emit({ type: 'turn_started', turn: s.turn, mana: manaForTurn(ctx, s.turn) });

  if (s.turn === ctx.rules.turns && ctx.rules.hype.autoDoubleFinalTurn) raiseStake(r, 'final_turn');

  s.terrains.forEach((t, i) => {
    const at = ctx.rules.terrainRevealTurns[i];
    if (!t.revealed && at !== undefined && at <= s.turn) {
      t.revealed = true;
      r.emit({ type: 'terrain_revealed', terrain: i, defId: t.defId });
    }
  });

  for (const p of PLAYERS) {
    for (let i = 0; i < ctx.rules.drawPerTurn; i++) r.draw(p);
  }

  runTriggers(r, 'start_of_turn');

  // Ordre de révélation annoncé dès le début du tour.
  const leader = computeLeader(ctx, s);
  if (leader !== null) {
    s.revealFirst = leader;
    s.revealFirstReason = 'leader';
  } else {
    s.revealFirst = r.rng.int(2) as PlayerIndex;
    s.revealFirstReason = 'coin_flip';
  }
  r.emit({ type: 'reveal_order', first: s.revealFirst, reason: s.revealFirstReason });
}

function endTurn(r: Resolver): void {
  const { s, ctx } = r;
  runTriggers(r, 'end_of_turn');
  for (const c of Object.values(s.cards)) {
    if (c.clickbaitUntilTurn !== null && c.clickbaitUntilTurn <= s.turn) c.clickbaitUntilTurn = null;
  }
  r.emit({ type: 'turn_ended', turn: s.turn });

  if (s.turn >= ctx.rules.turns) endGame(r);
  else startTurn(r);
}

function endGame(r: Resolver): void {
  const { s, ctx } = r;
  runTriggers(r, 'end_of_game');
  const result = { ...scoreMatch(ctx, s), stake: s.stake };
  s.result = result;
  s.phase = 'ended';
  r.emit({ type: 'match_ended', result });
}

export type PlayErrorCode =
  | 'not_planning'
  | 'not_in_hand'
  | 'duplicate_play'
  | 'invalid_terrain'
  | 'terrain_not_revealed'
  | 'terrain_full'
  | 'not_enough_mana';

export interface PlayError {
  code: PlayErrorCode;
  uid?: string;
  terrain?: number;
}

/** Vérifie les poses d'un joueur pour le tour en cours. Utilisé par le serveur avant `resolveTurn`. */
export function validatePlays(ctx: MatchContext, s: MatchState, player: PlayerIndex, sub: TurnSubmission): PlayError[] {
  if (s.phase !== 'planning') return [{ code: 'not_planning' }];
  const errors: PlayError[] = [];
  const seen = new Set<string>();
  const counts = s.terrains.map((t) => t.slots[player].length);
  let mana = 0;

  for (const { uid, terrain } of sub.plays) {
    if (seen.has(uid)) {
      errors.push({ code: 'duplicate_play', uid });
      continue;
    }
    seen.add(uid);
    if (!s.players[player].hand.includes(uid)) {
      errors.push({ code: 'not_in_hand', uid });
      continue;
    }
    if (!Number.isInteger(terrain) || terrain < 0 || terrain >= s.terrains.length) {
      errors.push({ code: 'invalid_terrain', uid, terrain });
      continue;
    }
    if (!terrainAt(s, terrain).revealed && !ctx.rules.allowPlayOnUnrevealedTerrain) {
      errors.push({ code: 'terrain_not_revealed', uid, terrain });
      continue;
    }
    counts[terrain] = (counts[terrain] ?? 0) + 1;
    if ((counts[terrain] as number) > ctx.rules.maxCardsPerTerrain) {
      errors.push({ code: 'terrain_full', uid, terrain });
      continue;
    }
    mana += playCost(ctx, s, s.cards[uid]!, terrain);
  }
  if (mana > manaForTurn(ctx, s.turn)) errors.push({ code: 'not_enough_mana' });
  return errors;
}

/**
 * Résout un tour simultané : pose face cachée des deux joueurs, puis révélation
 * (joueur `revealFirst` d'abord, chaque joueur dans son ordre de pose), fin de tour,
 * puis tour suivant ou fin de partie. Ne modifie pas l'état d'entrée.
 */
export function resolveTurn(ctx: MatchContext, state: MatchState, subs: [TurnSubmission, TurnSubmission]): StepResult {
  assertPlanning(state);
  for (const p of PLAYERS) {
    const errors = validatePlays(ctx, state, p, subs[p]);
    if (errors.length) throw new EngineError('invalid_plays', `Poses invalides (joueur ${p})`, { player: p, errors });
  }

  const s = cloneState(state);
  const r = new Resolver(ctx, s);
  const order: PlayerIndex[] = [s.revealFirst, other(s.revealFirst)];

  for (const p of order) {
    for (const { uid, terrain } of subs[p].plays) {
      const c = r.card(uid);
      r.removeFromHand(c);
      r.placeOnBoard(c, terrain, p);
      c.revealed = false;
      c.playedTurn = s.turn;
      r.emit({ type: 'card_played', player: p, uid, terrain });
    }
  }

  for (const p of order) {
    for (const { uid } of subs[p].plays) {
      const c = r.card(uid);
      if (c.zone === 'board' && !c.revealed) revealCard(r, c);
    }
  }

  endTurn(r);
  r.commit();
  return { state: s, events: r.events };
}

// ---------------------------------------------------------------------------
// Hype et abandon
// ---------------------------------------------------------------------------

export function canDeclareHype(ctx: MatchContext, s: MatchState, player: PlayerIndex): boolean {
  return s.phase === 'planning' && !s.players[player].hypeDeclared && s.stake < ctx.rules.hype.maxStake;
}

/** Déclare Hype : l'enjeu double immédiatement. Une fois par joueur. */
export function declareHype(ctx: MatchContext, state: MatchState, player: PlayerIndex): StepResult {
  assertPlanning(state);
  if (!canDeclareHype(ctx, state, player)) {
    throw new EngineError('hype_unavailable', 'Hype indisponible pour ce joueur.');
  }
  const s = cloneState(state);
  const r = new Resolver(ctx, s);
  s.players[player].hypeDeclared = true;
  r.emit({ type: 'hype_declared', player });
  raiseStake(r, 'hype');
  r.commit();
  return { state: s, events: r.events };
}

/** Lâcher : le joueur abandonne et ne perd que l'enjeu actuel. */
export function fold(ctx: MatchContext, state: MatchState, player: PlayerIndex): StepResult {
  assertPlanning(state);
  const s = cloneState(state);
  const r = new Resolver(ctx, s);
  const score = scoreMatch(ctx, s);
  const result = { ...score, winner: other(player), reason: 'fold' as const, stake: s.stake };
  s.result = result;
  s.phase = 'ended';
  r.emit({ type: 'match_ended', result });
  r.commit();
  return { state: s, events: r.events };
}
