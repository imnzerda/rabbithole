import { describe, expect, it } from 'vitest';
import cards from '../../content/data/prototype/cards.json';
import decks from '../../content/data/prototype/decks.json';
import { createContext } from '../src/context.js';
import { simulateMatchup } from '../src/simulate.js';
import type { CardDef } from '../src/types.js';

const ctx = createContext({ cards: cards as CardDef[] });
const deck = (i: number) => ({ leader: decks[i]!.leader, deck: decks[i]!.cards });

describe('simulations IA contre IA', () => {
  it('chaque partie se termine ; résultats cohérents et déterministes', () => {
    const r = simulateMatchup(ctx, deck(0), deck(1), 10, 'essai');
    expect(r.winsA + r.winsB + r.draws).toBe(10);
    expect(r.averageTurns).toBeGreaterThan(3);
    expect(simulateMatchup(ctx, deck(0), deck(1), 10, 'essai')).toEqual(r);
  });

  it('miroir : aucun deck ne domine nettement', () => {
    const r = simulateMatchup(ctx, deck(2), deck(2), 40, 'miroir');
    expect(Math.abs(r.winsA - r.winsB)).toBeLessThanOrEqual(16);
  });
});
