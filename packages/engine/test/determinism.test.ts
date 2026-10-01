import { describe, expect, it } from 'vitest';
import {
  canDeclareHype,
  createContext,
  createMatch,
  declareHype,
  getPlayerView,
  resolveTurn,
  Rng,
  type MatchContext,
  type MatchEvent,
  type MatchState,
  type PlayerIndex,
  type TurnSubmission,
} from '../src/index.js';
import { POOL, TERRAINS } from './fixtures.js';
import { randomSubmission } from './helpers.js';

const ctx: MatchContext = createContext({ cards: POOL, terrains: TERRAINS });

type Step = { kind: 'turn'; subs: [TurnSubmission, TurnSubmission] } | { kind: 'hype'; player: PlayerIndex };

/** Partie complète pilotée par deux IA aléatoires seedées. Renvoie l'état final, les événements et les actions. */
function playRandomGame(seed: string, botSeed: string) {
  const bot = Rng.fromSeed(botSeed);
  const deckOf = () => bot.shuffle(POOL.map((c) => c.id).filter((id) => id !== 'p_token')).slice(0, 12);
  const decks: [string[], string[]] = [deckOf(), deckOf()];
  let { state, events } = createMatch(ctx, {
    seed,
    players: [
      { id: 'A', deck: decks[0] },
      { id: 'B', deck: decks[1] },
    ],
  });
  const log: MatchEvent[] = [...events];
  const steps: Step[] = [];
  const states: MatchState[] = [state];

  while (state.phase === 'planning') {
    for (const p of [0, 1] as PlayerIndex[]) {
      if (bot.int(8) === 0 && canDeclareHype(ctx, state, p)) {
        ({ state, events } = declareHype(ctx, state, p));
        log.push(...events);
        steps.push({ kind: 'hype', player: p });
      }
    }
    const subs: [TurnSubmission, TurnSubmission] = [randomSubmission(ctx, state, 0, bot), randomSubmission(ctx, state, 1, bot)];
    ({ state, events } = resolveTurn(ctx, state, subs));
    log.push(...events);
    steps.push({ kind: 'turn', subs });
    states.push(state);
  }
  return { state, log, steps, states, decks };
}

function checkInvariants(s: MatchState): void {
  const seen = new Map<string, string>();
  const claim = (uid: string, where: string) => {
    expect(seen.has(uid), `${uid} présent dans ${seen.get(uid)} et ${where}`).toBe(false);
    seen.set(uid, where);
  };
  s.players.forEach((p, i) => {
    expect(p.hand.length).toBeLessThanOrEqual(ctx.rules.maxHandSize);
    p.hand.forEach((u) => (claim(u, `main ${i}`), expect(s.cards[u]?.zone).toBe('hand')));
    p.deck.forEach((u) => (claim(u, `pioche ${i}`), expect(s.cards[u]?.zone).toBe('deck')));
    p.destroyed.forEach((u) => (claim(u, `détruites ${i}`), expect(s.cards[u]?.zone).toBe('destroyed')));
    p.discarded.forEach((u) => (claim(u, `défaussées ${i}`), expect(s.cards[u]?.zone).toBe('discarded')));
  });
  s.terrains.forEach((t, ti) => {
    t.slots.forEach((slot, p) => {
      expect(slot.length).toBeLessThanOrEqual(ctx.rules.maxCardsPerTerrain);
      for (const u of slot) {
        claim(u, `terrain ${ti}/${p}`);
        expect(s.cards[u]).toMatchObject({ zone: 'board', terrain: ti, controller: p, revealed: true });
      }
    });
  });
  expect(seen.size).toBe(Object.keys(s.cards).length);
  expect(s.stake).toBeLessThanOrEqual(ctx.rules.hype.maxStake);
}

describe('déterminisme', () => {
  it('même seed + mêmes actions = même partie, octet pour octet', () => {
    const a = playRandomGame('match-42', 'bot-1');
    const b = playRandomGame('match-42', 'bot-1');
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log));
  });

  it('une seed différente donne une partie différente', () => {
    const a = playRandomGame('match-42', 'bot-1');
    const b = playRandomGame('match-43', 'bot-1');
    expect(JSON.stringify(b.state)).not.toBe(JSON.stringify(a.state));
  });

  it('replay : seed + decks + actions enregistrées reproduisent la partie', () => {
    const original = playRandomGame('replay-seed', 'bot-7');
    let { state } = createMatch(ctx, {
      seed: 'replay-seed',
      players: [
        { id: 'A', deck: original.decks[0] },
        { id: 'B', deck: original.decks[1] },
      ],
    });
    for (const step of original.steps) {
      state = step.kind === 'hype' ? declareHype(ctx, state, step.player).state : resolveTurn(ctx, state, step.subs).state;
    }
    expect(JSON.stringify(state)).toBe(JSON.stringify(original.state));
  });

  it("l'état reste du JSON pur à chaque tour", () => {
    const { states } = playRandomGame('json', 'bot-json');
    for (const s of states) expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('robustesse (300 parties aléatoires)', () => {
  it('aucune erreur, invariants respectés à chaque tour, résultat cohérent', () => {
    const reasons = new Set<string>();
    const keywords = new Set<string>();
    const eventTypes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const { state, states, log } = playRandomGame(`fuzz-${i}`, `bot-${i}`);
      states.forEach(checkInvariants);
      expect(state.phase).toBe('ended');
      expect(state.turn).toBe(ctx.rules.turns);
      const r = state.result!;
      reasons.add(r.reason);
      for (const e of log) {
        eventTypes.add(e.type);
        if (e.type === 'keyword_triggered') keywords.add(e.keyword);
      }
      if (r.reason === 'terrains') {
        expect(r.controllers.filter((c) => c === r.winner).length).toBeGreaterThanOrEqual(ctx.rules.terrainsToWin);
      }
      if (r.reason === 'total_power') expect(r.totalPower[r.winner!]).toBeGreaterThan(r.totalPower[r.winner === 0 ? 1 : 0]);
      // La vue de chaque joueur se construit sans erreur.
      getPlayerView(ctx, state, 0);
      getPlayerView(ctx, state, 1);
    }
    expect(reasons.has('terrains')).toBe(true);
    // Le fuzz exerce réellement chaque mot-clé et chaque type d'action.
    expect([...keywords].sort()).toEqual(
      ['clickbait', 'croissance', 'elan', 'ratio', 'rickroll', 'seduction', 'shitpost', 'viral', 'cancel'].sort(),
    );
    for (const t of ['card_destroyed', 'card_moved', 'card_stolen', 'card_created', 'card_transformed', 'card_discarded', 'card_hidden', 'power_set', 'random_choice', 'stake_changed']) {
      expect(eventTypes, t).toContain(t);
    }
  });
});
