import { describe, expect, it } from 'vitest';
import { canDeclareHype, EngineError } from '../src/index.js';
import { card } from './fixtures.js';
import { sandbox } from './helpers.js';

const v = (id: string, power: number) => card(id, { cost: 1, power });
const cards = [v('p2', 2), v('p3', 3), v('p3b', 3), v('p5', 5), v('p10', 10), v('p10b', 10)];
const all = cards.map((c) => c.id);

describe('décompte', () => {
  it('contrôler 2 terrains sur 3 gagne', () => {
    const g = sandbox({ cards, a: all, b: all });
    g.play([['p5', 0], ['p3', 1]], [['p10', 2], ['p2', 0]]).finish();
    expect(g.state.result).toMatchObject({ winner: 0, reason: 'terrains', controllers: [0, 0, 1] });
  });

  it('égalité sur un terrain : personne ne le contrôle', () => {
    const g = sandbox({ cards, a: all, b: all });
    g.play([['p3', 0]], [['p3b', 0]]).finish();
    expect(g.state.result?.controllers[0]).toBeNull();
  });

  it('1 terrain chacun + égalité : la puissance totale départage', () => {
    const g = sandbox({ cards, a: all, b: all });
    g.play([['p2', 0]], [['p10', 1]]).finish();
    expect(g.state.result).toMatchObject({
      winner: 1,
      reason: 'total_power',
      controllers: [0, 1, null],
      totalPower: [2, 10],
    });
  });

  it('égalité parfaite : match nul', () => {
    const g = sandbox({ cards, a: all, b: all });
    g.play([['p3', 0], ['p10', 1]], [['p3b', 0], ['p10b', 1]]).finish();
    expect(g.state.result).toMatchObject({ winner: null, reason: 'draw' });
  });
});

describe('Hype', () => {
  it("double l'enjeu immédiatement", () => {
    const g = sandbox({ cards, a: [], b: [] });
    g.hype(0);
    expect(g.state.stake).toBe(2);
    expect(g.events).toContainEqual({ type: 'stake_changed', stake: 2, reason: 'hype' });
  });

  it('une seule déclaration par joueur', () => {
    const g = sandbox({ cards, a: [], b: [] });
    g.hype(0);
    expect(canDeclareHype(g.ctx, g.state, 0)).toBe(false);
    expect(() => g.hype(0)).toThrow(EngineError);
    expect(canDeclareHype(g.ctx, g.state, 1)).toBe(true);
  });

  it("sans Hype, l'enjeu reste à 1 (pas de doublement caché au dernier tour)", () => {
    const g = sandbox({ cards, a: [], b: [] }).finish();
    expect(g.state.result?.stake).toBe(1);
    expect(g.eventsOf('stake_changed')).toEqual([]);
  });

  it('deux Hype : 1 → 2 → 4, plafond atteint', () => {
    const g = sandbox({ cards, a: [], b: [] });
    g.hype(0).pass().hype(1);
    expect(g.state.stake).toBe(4);
    g.finish();
    expect(g.state.result?.stake).toBe(4);
  });

  it("l'enjeu est plafonné par la config", () => {
    const g = sandbox({ cards, a: [], b: [], rules: { hype: { maxStake: 2 } } });
    g.hype(0);
    expect(canDeclareHype(g.ctx, g.state, 1)).toBe(false);
    g.finish();
    expect(g.state.result?.stake).toBe(2);
  });

  it('doublement automatique au dernier tour réactivable par la config', () => {
    const g = sandbox({ cards, a: [], b: [], rules: { hype: { autoDoubleFinalTurn: true, maxStake: 8 } } });
    g.hype(0).hype(1).finish();
    expect(g.state.result?.stake).toBe(8);
  });

  it("Lâcher : l'abandon ne coûte que l'enjeu actuel", () => {
    const g = sandbox({ cards, a: [], b: [] });
    g.hype(1).fold(0);
    expect(g.state.phase).toBe('ended');
    expect(g.state.result).toMatchObject({ winner: 1, reason: 'fold', stake: 2 });
  });

  it('aucune action après la fin', () => {
    const g = sandbox({ cards, a: [], b: [] }).fold(1);
    expect(() => g.hype(0)).toThrow(EngineError);
    expect(() => g.fold(0)).toThrow(EngineError);
  });
});
