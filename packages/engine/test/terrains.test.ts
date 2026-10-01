import { describe, expect, it } from 'vitest';
import { handCosts, validatePlays, type CardDef } from '../src/index.js';
import { card } from './fixtures.js';
import { sandbox } from './helpers.js';

const v = (id: string, power: number, p: Partial<CardDef> = {}) => card(id, { cost: 1, power, ...p });

describe('terrains', () => {
  const crook = v('crook', 3, { categories: ['crimes_scandales'] });

  it('Prohibition : Crimes et scandales +2', () => {
    const g = sandbox({ cards: [crook], a: ['crook'], b: [], terrains: ['prohibition', 'neutral_2', 'neutral_3'] });
    g.play([['crook', 0]]);
    expect(g.power('crook')).toBe(5);
  });

  it('Tribunal : Crimes et scandales -2', () => {
    const g = sandbox({ cards: [crook], a: ['crook'], b: [], terrains: ['tribunal', 'neutral_2', 'neutral_3'] });
    g.play([['crook', 0]]);
    expect(g.power('crook')).toBe(1);
  });

  it("un terrain non révélé n'a pas d'effet", () => {
    const g = sandbox({
      cards: [crook],
      a: ['crook'],
      b: [],
      terrains: ['neutral_1', 'neutral_2', 'prohibition'],
      rules: { startingHand: 6, terrainRevealTurns: [1, 2, 3], allowPlayOnUnrevealedTerrain: true },
    });
    g.play([['crook', 2]]);
    expect(g.power('crook')).toBe(3);
    g.pass();
    expect(g.power('crook')).toBe(5);
  });

  it('Concert : les cartes Musique donnent +1 à leurs alliés ici', () => {
    const cards = [v('singer', 2, { categories: ['musique'] }), v('fan', 1), v('enemy', 1)];
    const g = sandbox({ cards, a: ['singer', 'fan'], b: ['enemy'], terrains: ['concert', 'neutral_2', 'neutral_3'] });
    g.play([['singer', 0], ['fan', 0]], [['enemy', 0]]);
    expect(g.power('fan')).toBe(2);
    expect(g.power('singer')).toBe(2);
    expect(g.power('enemy')).toBe(1);
  });

  it('Serveur Discord : les cartes Internet coûtent 1 de moins ici', () => {
    const cards = [v('streamer', 4, { cost: 2, categories: ['internet'] }), v('athlete', 4, { cost: 2, categories: ['sport'] })];
    const g = sandbox({
      cards,
      a: ['streamer', 'athlete'],
      b: [],
      terrains: ['serveur_discord', 'neutral_2', 'neutral_3'],
      rules: { startingHand: 6, terrainRevealTurns: [1, 1, 1] },
    });
    expect(validatePlays(g.ctx, g.state, 0, g.submission(0, [['streamer', 0]]))).toEqual([]);
    expect(validatePlays(g.ctx, g.state, 0, g.submission(0, [['streamer', 1]]))[0]?.code).toBe('not_enough_mana');
    expect(validatePlays(g.ctx, g.state, 0, g.submission(0, [['athlete', 0]]))[0]?.code).toBe('not_enough_mana');
    expect(handCosts(g.ctx, g.state, 0)[g.handUid(0, 'streamer')]).toEqual([1, 2, 2]);
  });

  it('Le métro parisien : cartes FR +2', () => {
    const cards = [v('parisien', 2, { country: 'FR' }), v('touriste', 2, { country: 'US' })];
    const g = sandbox({ cards, a: ['parisien', 'touriste'], b: [], terrains: ['metro_parisien', 'neutral_2', 'neutral_3'] });
    g.play([['parisien', 0], ['touriste', 0]]);
    expect(g.power('parisien')).toBe(4);
    expect(g.power('touriste')).toBe(2);
  });

  it('Las Vegas : random_of se déclenche deux fois', () => {
    const dice = v('dice', 0, {
      effects: [
        {
          trigger: 'on_reveal',
          action: { type: 'random_of', options: [{ type: 'add_power', target: 'self', amount: 1 }] },
        },
      ],
    });
    const g = sandbox({ cards: [dice], a: ['dice'], b: [], terrains: ['las_vegas', 'neutral_2', 'neutral_3'] });
    g.play([['dice', 0]]);
    expect(g.power('dice')).toBe(2);
  });
});
