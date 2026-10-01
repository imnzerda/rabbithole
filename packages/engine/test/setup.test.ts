import { describe, expect, it } from 'vitest';
import { createMatch, EngineError, getPlayerView, validateDeck } from '../src/index.js';
import { card, FILLERS } from './fixtures.js';
import { makeContext, sandbox } from './helpers.js';

const fillers = FILLERS.flatMap((f) => [f.id, f.id]);

describe('mise en place', () => {
  it('main de 5, Vies du Leader, premier joueur sans pioche avec 1 Buzz', () => {
    const g = sandbox();
    const [a, b] = g.state.players;
    expect(a.hand).toHaveLength(5);
    expect(b.hand).toHaveLength(5);
    expect(a.life).toHaveLength(4);
    expect(b.life).toHaveLength(4);
    expect(a.deck).toHaveLength(11);
    expect(g.state.turn).toBe(1);
    expect(g.state.active).toBe(0);
    expect(a.buzzActive).toBe(1);
    expect(a.buzzDeck).toBe(9);
  });

  it('le second joueur pioche et gagne 2 Buzz ; le Buzz plafonne à 10', () => {
    const g = sandbox().end();
    expect(g.state.active).toBe(1);
    expect(g.state.players[1].hand).toHaveLength(6);
    expect(g.state.players[1].buzzActive).toBe(2);
    g.toTurn(12); // le joueur 1 a joué ses tours 2, 4, …, 12 → 2 × 6 = 12, plafonné à 10
    expect(g.state.players[1].buzzActive).toBe(10);
    expect(g.state.players[1].buzzDeck).toBe(0);
  });

  it('mulligan : chaque joueur décide à son tour, puis Vies et premier tour', () => {
    const g = sandbox({ mulligan: true });
    expect(g.phase).toBe('mulligan');
    expect(g.state.players[0].life).toHaveLength(0);
    const before = [...g.state.players[0].hand];
    g.act(0, { type: 'mulligan', redraw: true });
    expect(g.state.players[0].hand).not.toEqual(before);
    expect(g.state.players[0].hand).toHaveLength(5);
    expect(() => g.act(0, { type: 'mulligan', redraw: false })).toThrow(EngineError);
    g.act(1, { type: 'mulligan', redraw: false });
    expect(g.phase).toBe('main');
    expect(g.state.players[1].life).toHaveLength(4);
  });

  it('premier joueur tiré au sort de façon déterministe', () => {
    const ctx = makeContext();
    const first = (seed: string) =>
      createMatch(ctx, {
        seed,
        players: [
          { id: 'A', leader: 'leader_a', deck: fillers },
          { id: 'B', leader: 'leader_b', deck: fillers },
        ],
        skipMulligan: true,
      }).state.first;
    expect(first('s1')).toBe(first('s1'));
    expect(new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map(first)).size).toBe(2);
  });
});

describe('validation des decks', () => {
  const ctx = makeContext([card('net', { categories: ['internet'] }), card('sport', { categories: ['sport'] })]);

  it('accepte un deck valide', () => {
    expect(validateDeck(ctx, 'leader_a', fillers)).toEqual([]);
  });

  it('refuse taille, copies, catégories hors Leader, Leader dans le deck, Leader inconnu', () => {
    expect(validateDeck(ctx, 'leader_a', fillers.slice(1))[0]).toContain('20 cartes');
    expect(validateDeck(ctx, 'leader_a', [...fillers.slice(1), 'filler_1'])).toContainEqual(expect.stringContaining('exemplaires'));
    expect(validateDeck(ctx, 'leader_a', [...fillers.slice(1), 'sport'])).toContainEqual(expect.stringContaining('catégorie'));
    expect(validateDeck(ctx, 'leader_a', [...fillers.slice(1), 'leader_b'])).toContainEqual(expect.stringContaining('Leader ne va pas'));
    expect(validateDeck(ctx, 'net', fillers)).toContainEqual(expect.stringContaining("n'est pas un Leader"));
    expect(() =>
      createMatch(ctx, { seed: 's', players: [{ id: 'A', leader: 'leader_a', deck: [] }, { id: 'B', leader: 'leader_b', deck: fillers }] }),
    ).toThrow(EngineError);
  });
});

describe('déroulement des tours', () => {
  it('seul le joueur actif agit ; une action hors phase est refusée', () => {
    const g = sandbox();
    expect(() => g.end(1)).toThrow(/pas à ce joueur/);
    expect(() => g.act(0, { type: 'block', blocker: null })).toThrow(/phase/);
  });

  it('début de tour : tout se redresse, les Buzz attachés reviennent', () => {
    const g = sandbox({ cards: [card('x', { cost: 0 })] });
    g.place(0, 'x', { rested: true }).setBuzz(0, 3);
    g.act(0, { type: 'attach', target: g.uid(0, 'x'), amount: 2 });
    expect(g.card(0, 'x').buzz).toBe(2);
    g.end().end();
    expect(g.card(0, 'x').rested).toBe(false);
    expect(g.card(0, 'x').buzz).toBe(0);
    expect(g.state.players[0].buzzActive).toBe(5); // 1 + 2 récupérés + 2 gagnés
  });

  it('pioche vide au moment de piocher : défaite', () => {
    const g = sandbox();
    g.state.players[1].deck = [];
    g.end();
    expect(g.state.result).toMatchObject({ winner: 0, reason: 'deck_out' });
  });

  it('limite de tours : plus de Vies l’emporte', () => {
    const g = sandbox({ rules: { maxTurns: 3 } });
    g.setLife(1, 2).toTurn(4);
    expect(g.state.result).toMatchObject({ winner: 0, reason: 'turn_limit' });
  });

  it("n'altère jamais l'état d'entrée", () => {
    const g = sandbox();
    const before = JSON.stringify(g.state);
    const frozen = JSON.parse(before);
    const view = getPlayerView(g.ctx, frozen, 0);
    expect(view.turn).toBe(1);
    g.end();
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe('minuteur', () => {
  it('timeoutAction : action par défaut légale pour chaque décision', async () => {
    const { timeoutAction } = await import('../src/index.js');
    const g = sandbox({ mulligan: true });
    let guard = 0;
    while (g.state.phase !== 'ended' && guard++ < 500) {
      const t = timeoutAction(g.state)!;
      g.act(t.player, t.action);
    }
    // À force de finir les tours sans jouer, une pioche finit par se vider.
    expect(g.state.result?.reason).toBe('deck_out');
  });
});
