import { describe, expect, it } from 'vitest';
import {
  createContext,
  createMatch,
  EngineError,
  getPlayerView,
  resolveTurn,
  validatePlays,
  type MatchState,
} from '../src/index.js';
import { card, FILLERS, TERRAINS } from './fixtures.js';
import { sandbox } from './helpers.js';

const v = (id: string, cost: number, power: number) => card(id, { cost, power });

describe('mise en place', () => {
  it('main de 3 + pioche du tour 1, terrain 1 révélé seul', () => {
    const g = sandbox({ cards: [], a: [], b: [], rules: {} });
    const s = g.state;
    expect(s.turn).toBe(1);
    expect(s.players[0].hand).toHaveLength(4);
    expect(s.players[0].deck).toHaveLength(8);
    expect(s.terrains.map((t) => t.revealed)).toEqual([true, false, false]);
  });

  it('révèle le terrain 2 au tour 2 et le terrain 3 au tour 3', () => {
    const g = sandbox({ cards: [], a: [], b: [], rules: {} });
    g.pass();
    expect(g.state.terrains.map((t) => t.revealed)).toEqual([true, true, false]);
    g.pass();
    expect(g.state.terrains.map((t) => t.revealed)).toEqual([true, true, true]);
    expect(g.eventsOf('terrain_revealed').map((e) => e.terrain)).toEqual([0, 1, 2]);
  });

  it('le mana disponible est égal au numéro du tour', () => {
    const g = sandbox({ cards: [], a: [], b: [], rules: {} });
    for (let turn = 1; turn <= 6; turn++) {
      expect(getPlayerView(g.ctx, g.state, 0).mana).toBe(turn);
      g.pass();
    }
    expect(g.state.phase).toBe('ended');
  });

  it('rejette les decks invalides', () => {
    const ctx = createContext({ cards: FILLERS, terrains: TERRAINS });
    const ids = FILLERS.map((f) => f.id);
    const setup = (deck: string[]) => () =>
      createMatch(ctx, { seed: 's', players: [{ id: 'A', deck }, { id: 'B', deck: ids }] });
    expect(setup(ids.slice(0, 11))).toThrow(EngineError);
    expect(setup([...ids.slice(0, 11), ids[0]!])).toThrow(/Deck invalide/);
    expect(setup([...ids.slice(0, 11), 'inconnue'])).toThrow(EngineError);
  });

  it('tire 3 terrains distincts de façon déterministe', () => {
    const ctx = createContext({ cards: FILLERS, terrains: TERRAINS });
    const ids = FILLERS.map((f) => f.id);
    const make = (seed: string) =>
      createMatch(ctx, { seed, players: [{ id: 'A', deck: ids }, { id: 'B', deck: ids }] }).state.terrains.map(
        (t) => t.defId,
      );
    const a = make('seed-1');
    expect(new Set(a).size).toBe(3);
    expect(make('seed-1')).toEqual(a);
    const others = ['seed-2', 'seed-3', 'seed-4', 'seed-5'].map(make);
    expect(others.some((o) => JSON.stringify(o) !== JSON.stringify(a))).toBe(true);
  });

  it('mélange les decks selon la seed', () => {
    const ctx = createContext({ cards: FILLERS, terrains: TERRAINS });
    const ids = FILLERS.map((f) => f.id);
    const hand = (seed: string) => {
      const { state } = createMatch(ctx, { seed, players: [{ id: 'A', deck: ids }, { id: 'B', deck: ids }] });
      return state.players[0].hand.map((u) => state.cards[u]!.defId).join();
    };
    expect(hand('m1')).toBe(hand('m1'));
    expect(new Set(['m1', 'm2', 'm3', 'm4', 'm5'].map(hand)).size).toBeGreaterThan(1);
  });
});

describe('pioche et main', () => {
  it('main limitée à 7 : la pioche échoue sans brûler de carte', () => {
    const g = sandbox({ cards: [], a: [], b: [], rules: {} });
    g.pass(3); // tour 4 : 3 + 4 = 7
    expect(g.state.players[0].hand).toHaveLength(7);
    g.pass(); // tour 5
    expect(g.state.players[0].hand).toHaveLength(7);
    expect(g.state.players[0].deck).toHaveLength(5);
    expect(g.events.some((e) => e.type === 'draw_failed' && e.reason === 'hand_full')).toBe(true);
  });

  it('pioche vide : aucun effet', () => {
    const g = sandbox({ cards: [], a: [], b: [], rules: { drawPerTurn: 5, maxHandSize: 30 } });
    g.pass();
    expect(g.state.players[0].hand).toHaveLength(12);
    expect(g.state.players[0].deck).toHaveLength(0);
    expect(g.events.some((e) => e.type === 'draw_failed' && e.reason === 'deck_empty')).toBe(true);
  });
});

describe('validation des poses', () => {
  const cards = [v('c0', 0, 1), v('c0b', 0, 1), v('c0c', 0, 1), v('c0d', 0, 1), v('c0e', 0, 1), v('c2', 2, 3)];
  const g = () => sandbox({ cards, a: cards.map((c) => c.id), b: [], rules: { startingHand: 6, terrainRevealTurns: [1, 2, 3] } });

  it('refuse une carte absente de la main, en double, ou un terrain invalide', () => {
    const game = g();
    const uid = game.handUid(0, 'c0');
    const errors = validatePlays(game.ctx, game.state, 0, {
      plays: [
        { uid: 'nope', terrain: 0 },
        { uid, terrain: 0 },
        { uid, terrain: 1 },
        { uid: game.handUid(0, 'c0b'), terrain: 7 },
      ],
    });
    expect(errors.map((e) => e.code)).toEqual(['not_in_hand', 'duplicate_play', 'invalid_terrain']);
  });

  it('refuse le dépassement de mana', () => {
    const game = g();
    expect(validatePlays(game.ctx, game.state, 0, game.submission(0, [['c2', 0]])).map((e) => e.code)).toEqual([
      'not_enough_mana',
    ]);
  });

  it('max 4 cartes par joueur et par terrain, cartes déjà posées comprises', () => {
    const game = g();
    const five = game.submission(0, [['c0', 0], ['c0b', 0], ['c0c', 0], ['c0d', 0], ['c0e', 0]]);
    expect(validatePlays(game.ctx, game.state, 0, five).map((e) => e.code)).toEqual(['terrain_full']);
    game.play([['c0', 0], ['c0b', 0], ['c0c', 0]]);
    const two = game.submission(0, [['c0d', 0], ['c0e', 0]]);
    expect(validatePlays(game.ctx, game.state, 0, two).map((e) => e.code)).toEqual(['terrain_full']);
  });

  it('pose sur terrain non révélé interdite par défaut, autorisée si configuré', () => {
    const game = g();
    expect(validatePlays(game.ctx, game.state, 0, game.submission(0, [['c0', 2]]))[0]?.code).toBe('terrain_not_revealed');
    const open = sandbox({
      cards,
      a: cards.map((c) => c.id),
      b: [],
      rules: { startingHand: 6, terrainRevealTurns: [1, 2, 3], allowPlayOnUnrevealedTerrain: true },
    });
    expect(validatePlays(open.ctx, open.state, 0, open.submission(0, [['c0', 2]]))).toEqual([]);
  });

  it('resolveTurn lève une erreur sur des poses invalides', () => {
    const game = g();
    expect(() =>
      resolveTurn(game.ctx, game.state, [{ plays: [{ uid: 'nope', terrain: 0 }] }, { plays: [] }]),
    ).toThrow(EngineError);
  });
});

describe('résolution du tour', () => {
  const cards = [v('a1', 1, 3), v('a2', 1, 2), v('b1', 1, 1)];

  it("ne modifie pas l'état d'entrée", () => {
    const g = sandbox({ cards, a: ['a1'], b: ['b1'] });
    const before = JSON.stringify(g.state);
    const frozen: MatchState = JSON.parse(before);
    resolveTurn(g.ctx, frozen, [g.submission(0, [['a1', 0]]), g.submission(1, [['b1', 0]])]);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('pose face cachée puis révèle, et la carte quitte la main', () => {
    const g = sandbox({ cards, a: ['a1'], b: ['b1'] });
    g.play([['a1', 0]], [['b1', 1]]);
    const a1 = g.card('a1');
    expect(a1.zone).toBe('board');
    expect(a1.revealed).toBe(true);
    expect(g.state.players[0].hand).not.toContain(a1.uid);
    const types = g.events.map((e) => e.type);
    expect(types.indexOf('card_played')).toBeLessThan(types.indexOf('card_revealed'));
  });

  it('tirage au sort annoncé au début du tour en cas d’égalité', () => {
    const g = sandbox({ cards, a: ['a1'], b: ['b1'] });
    expect(g.state.revealFirstReason).toBe('coin_flip');
    expect(g.events.some((e) => e.type === 'reveal_order' && e.reason === 'coin_flip')).toBe(true);
  });

  it('le joueur qui mène révèle en premier', () => {
    const g = sandbox({ cards, a: ['a1', 'a2'], b: ['b1'] });
    g.play([['a1', 0]], [['b1', 1]]);
    expect(g.state.revealFirst).toBe(0);
    expect(g.state.revealFirstReason).toBe('leader');
    g.play([['a2', 2]], []);
    const reveals = g.events.filter((e) => e.type === 'card_revealed');
    expect(reveals[0]?.player).toBe(0);
  });

  it('les révélations suivent l’ordre de pose de chaque joueur', () => {
    const g = sandbox({ cards, a: ['a1', 'a2'], b: [] });
    g.play([['a2', 1], ['a1', 0]]);
    expect(g.eventsOf('card_revealed').map((e) => e.defId)).toEqual(['a2', 'a1']);
  });

  it('après le tour 6, la partie est terminée et refuse toute action', () => {
    const g = sandbox({ cards, a: [], b: [] }).finish();
    expect(g.state.phase).toBe('ended');
    expect(g.state.result).not.toBeNull();
    expect(() => g.pass()).toThrow(/terminée/);
  });
});
