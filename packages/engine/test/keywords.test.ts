import { describe, expect, it } from 'vitest';
import { getPlayerView, type CardDef, type RulesOverride } from '../src/index.js';
import { card } from './fixtures.js';
import { sandbox, SANDBOX_RULES } from './helpers.js';

const v = (id: string, power: number, p: Partial<CardDef> = {}) => card(id, { cost: 1, power, ...p });
const aura = (id: string, power: number) =>
  v(id, power, { effects: [{ trigger: 'continuous', action: { type: 'add_power', target: 'allies_here', amount: 2 } }] });

describe('Élan', () => {
  const cards = [v('elan', 2, { keywords: ['elan'] })];

  it('+2 si jouée aux tours 1 à 3', () => {
    const g = sandbox({ cards, a: ['elan'], b: [] }).play([['elan', 0]]);
    expect(g.power('elan')).toBe(4);
  });

  it('aucun bonus au tour 4', () => {
    const g = sandbox({ cards, a: ['elan'], b: [] }).pass(3).play([['elan', 0]]);
    expect(g.power('elan')).toBe(2);
  });

  it('Stade : Élan à tous les tours', () => {
    const g = sandbox({ cards, a: ['elan'], b: [], terrains: ['stade', 'neutral_2', 'neutral_3'] });
    g.pass(3).play([['elan', 0]]);
    expect(g.power('elan')).toBe(4);
  });
});

describe('Croissance', () => {
  it('+1 à chaque fin de tour, y compris celui de la pose', () => {
    const g = sandbox({ cards: [v('grow', 1, { keywords: ['croissance'] })], a: ['grow'], b: [] });
    g.play([['grow', 0]]);
    expect(g.power('grow')).toBe(2);
    g.pass();
    expect(g.power('grow')).toBe(3);
  });
});

describe('Clickbait', () => {
  const bait = v('bait', 1, { keywords: ['clickbait'] });

  it("+4 réel, visible par les deux joueurs, jusqu'à la fin du tour suivant", () => {
    const g = sandbox({ cards: [bait], a: ['bait'], b: [] });
    g.play([['bait', 0]]);
    expect(g.power('bait')).toBe(5);
    expect(getPlayerView(g.ctx, g.state, 1).terrains[0]?.cards[0][0]).toMatchObject({ power: 5, clickbait: true });
    expect(getPlayerView(g.ctx, g.state, 0).terrains[0]?.cards[0][0]?.power).toBe(5);
    g.pass();
    expect(g.power('bait')).toBe(1);
    expect(getPlayerView(g.ctx, g.state, 1).terrains[0]?.cards[0][0]).toMatchObject({ power: 1, clickbait: false });
  });

  it('compte au décompte si encore actif', () => {
    const cards = [bait, v('b3', 3)];
    const late = sandbox({ cards, a: ['bait'], b: ['b3'] }).pass(5).play([['bait', 0]], [['b3', 0]]);
    expect(late.state.result?.controllers[0]).toBe(0);
    const early = sandbox({ cards, a: ['bait'], b: ['b3'] }).play([['bait', 0]], [['b3', 0]]).finish();
    expect(early.state.result?.controllers[0]).toBe(1);
  });
});

describe('Viral', () => {
  it('crée une copie (puissance -1) sur un autre terrain, sans réaction en chaîne', () => {
    const g = sandbox({ cards: [v('vir', 5, { keywords: ['viral'] })], a: ['vir'], b: [] });
    g.play([['vir', 0]]);
    const copies = g.instances('vir').filter((c) => c.token);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.terrain).not.toBe(0);
    expect(copies[0]?.zone).toBe('board');
    expect(g.power('vir')).toBe(5);
    expect(g.instances('vir')).toHaveLength(2);
    const powers = g.terrainPowers().map(([a]) => a);
    expect(powers.filter((p) => p === 4)).toHaveLength(1);
  });

  it('aucune copie si les autres terrains sont pleins', () => {
    const zs = Array.from({ length: 8 }, (_, i) => v(`z${i}`, 1, { cost: 0 }));
    const cards = [...zs, v('vir', 5, { keywords: ['viral'] })];
    const g = sandbox({ cards, a: cards.map((c) => c.id), b: [] });
    g.play([['z0', 1], ['z1', 1], ['z2', 1], ['z3', 1]]);
    g.play([['z4', 2], ['z5', 2], ['z6', 2], ['z7', 2]]);
    g.play([['vir', 0]]);
    expect(g.instances('vir')).toHaveLength(1);
  });
});

describe('Ratio', () => {
  it('la carte adverse la plus forte ici perd 3, sans condition', () => {
    const cards = [v('ratio', 2, { keywords: ['ratio'] }), v('b7', 7), v('b2', 2)];
    const g = sandbox({ cards, a: ['ratio'], b: ['b7', 'b2'] });
    g.play([], [['b7', 0], ['b2', 0]]).play([['ratio', 0]]);
    expect(g.power('b7')).toBe(4);
    expect(g.power('b2')).toBe(2);
  });
});

describe('Cancel', () => {
  it('la carte adverse la plus forte ici qui a un effet le perd', () => {
    const cards = [aura('aura', 3), v('b9', 9), v('b1', 1), v('cancel', 3, { keywords: ['cancel'] })];
    const g = sandbox({ cards, a: ['cancel'], b: ['aura', 'b9', 'b1'] });
    g.play([], [['aura', 0], ['b9', 0], ['b1', 0]]);
    expect(g.power('b1')).toBe(3);
    g.play([['cancel', 0]]);
    expect(g.power('b1')).toBe(1);
    expect(g.card('aura').effectsCancelled).toBe(true);
    expect(g.card('b9').effectsCancelled).toBe(false);
  });

  it('stoppe Croissance', () => {
    const cards = [v('grow', 2, { keywords: ['croissance'] }), v('cancel', 3, { keywords: ['cancel'] })];
    const g = sandbox({ cards, a: ['cancel'], b: ['grow'] });
    g.play([], [['grow', 0]]); // fin du tour 1 : 3
    g.play([['cancel', 0]]); // plus de +1 ensuite
    expect(g.power('grow')).toBe(3);
  });
});

describe('Rickroll', () => {
  const rick = v('rick', 2, { keywords: ['rickroll'] });

  it('envoie la carte adverse la plus forte ici sur un autre terrain', () => {
    const g = sandbox({ cards: [rick, v('b9', 9), v('b1', 1)], a: ['rick'], b: ['b9', 'b1'] });
    g.play([], [['b1', 0], ['b9', 0]]).play([['rick', 0]]);
    const b9 = g.card('b9');
    expect(b9.terrain).not.toBe(0);
    expect(b9.controller).toBe(1);
    expect(g.card('b1').terrain).toBe(0);
  });

  it("sans effet si aucun autre terrain n'a de place", () => {
    const zs = Array.from({ length: 8 }, (_, i) => v(`z${i}`, 0, { cost: 0 }));
    const cards = [rick, v('b9', 9), ...zs];
    const g = sandbox({ cards, a: ['rick'], b: ['b9', ...zs.map((z) => z.id)] });
    g.play([], [['b9', 0], ['z0', 1], ['z1', 1], ['z2', 1], ['z3', 1]]);
    g.play([], [['z4', 2], ['z5', 2], ['z6', 2]]);
    g.play([['rick', 0]], [['z7', 2]]); // les poses ont lieu avant les révélations
    expect(g.card('b9').terrain).toBe(0);
    expect(g.eventsOf('keyword_triggered').some((e) => e.keyword === 'rickroll')).toBe(false);
  });
});

describe('Shitpost', () => {
  const sp = v('sp', 1, { keywords: ['shitpost'] });
  const rules: RulesOverride = {
    ...SANDBOX_RULES,
    keywords: { shitpost: { table: [{ weight: 1, action: { type: 'add_power', target: 'self', amount: 5 } }] } },
  };

  it('tire un effet de la table', () => {
    const g = sandbox({ cards: [sp], a: ['sp'], b: [], rules });
    g.play([['sp', 0]]);
    expect(g.power('sp')).toBe(6);
  });

  it('Las Vegas : deux fois', () => {
    const g = sandbox({ cards: [sp], a: ['sp'], b: [], rules, terrains: ['las_vegas', 'neutral_2', 'neutral_3'] });
    g.play([['sp', 0]]);
    expect(g.power('sp')).toBe(11);
  });

  it('table par défaut : un tirage, entre +0 et +8 sur la carte', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const g = sandbox({ cards: [sp], a: ['sp'], b: [], seed });
      g.play([['sp', 0]]);
      expect(g.events.filter((e) => e.type === 'random_choice')).toHaveLength(1);
      expect([1, 2, 3, 4, 5, 9]).toContain(g.power('sp'));
    }
  });
});

describe('Séduction', () => {
  it('fait passer la carte adverse la plus faible du terrain dans mon camp', () => {
    const cards = [v('w1', 1), v('w6', 6), v('sed', 3, { keywords: ['seduction'] })];
    const g = sandbox({ cards, a: ['sed'], b: ['w1', 'w6'] });
    g.play([], [['w6', 0], ['w1', 0]]).play([['sed', 0]]);
    const w1 = g.card('w1');
    expect(w1.controller).toBe(0);
    expect(w1.owner).toBe(1);
    expect(g.state.terrains[0]?.slots[0]).toContain(w1.uid);
    expect(g.terrainPowers()[0]).toEqual([4, 6]);
  });

  it('sans effet si mon côté du terrain est plein', () => {
    const zs = Array.from({ length: 3 }, (_, i) => v(`z${i}`, 1, { cost: 0 }));
    const cards = [...zs, v('w1', 1), v('sed', 3, { keywords: ['seduction'] })];
    const g = sandbox({ cards, a: ['z0', 'z1', 'z2', 'sed'], b: ['w1'] });
    g.play([['z0', 0], ['z1', 0], ['z2', 0]], [['w1', 0]]).play([['sed', 0]]);
    expect(g.card('w1').controller).toBe(1);
  });
});

describe('Tendance', () => {
  it('+1 puissance pour les cartes en tendance du jour', () => {
    const cards = [v('hot', 2), v('cold', 2)];
    const g = sandbox({ cards, a: ['hot', 'cold'], b: [], trending: ['hot'] });
    g.play([['hot', 0], ['cold', 1]]);
    expect(g.power('hot')).toBe(3);
    expect(g.power('cold')).toBe(2);
    expect(getPlayerView(g.ctx, g.state, 1).terrains[0]?.cards[0][0]?.trending).toBe(true);
  });

  it('le filtre de mot-clé `tendance` reconnaît les cartes en tendance', () => {
    const fan = v('fan', 1, {
      effects: [
        {
          trigger: 'continuous',
          action: { type: 'add_power', target: 'allies_here', filter: { keywords: ['tendance'] }, amount: 3 },
        },
      ],
    });
    const g = sandbox({ cards: [fan, v('hot', 2), v('cold', 2)], a: ['fan', 'hot', 'cold'], b: [], trending: ['hot'] });
    g.play([['fan', 0], ['hot', 0], ['cold', 0]]);
    expect(g.power('hot')).toBe(6);
    expect(g.power('cold')).toBe(2);
  });
});
