import { describe, expect, it } from 'vitest';
import { getPlayerView, type Action, type CardDef, type Effect } from '../src/index.js';
import { card } from './fixtures.js';
import { sandbox, SANDBOX_RULES } from './helpers.js';

const v = (id: string, power: number, p: Partial<CardDef> = {}) => card(id, { cost: 1, power, ...p });
const onReveal = (id: string, action: Action, power = 2, extra: Partial<Effect> = {}) =>
  v(id, power, { effects: [{ trigger: 'on_reveal', action, ...extra }] });

/** B pose `bCards` au tour 1 sur le terrain 0, puis A pose `aCard` au tour 2 sur le terrain 0. */
function versus(aCard: CardDef, bCards: CardDef[], extra: CardDef[] = []) {
  const g = sandbox({ cards: [aCard, ...bCards, ...extra], a: [aCard.id], b: bCards.map((c) => c.id) });
  g.play([], bCards.map((c) => [c.id, 0] as [string, number]));
  g.play([[aCard.id, 0]]);
  return g;
}

describe('cibles', () => {
  it('self, allies_here, enemies_here, all_here', () => {
    const cards = [
      onReveal('buffer', { type: 'add_power', target: 'allies_here', amount: 2 }),
      onReveal('nerfer', { type: 'add_power', target: 'enemies_here', amount: -1 }),
      onReveal('party', { type: 'add_power', target: 'all_here', amount: 1 }),
      v('a1', 1),
      v('b5', 5),
    ];
    const g = sandbox({ cards, a: ['a1', 'buffer', 'nerfer', 'party'], b: ['b5'] });
    g.play([['a1', 0]], [['b5', 0]]);
    g.play([['buffer', 0], ['nerfer', 0], ['party', 0]]);
    // a1 : 1 +2 (buffer) +1 (party) ; buffer : 2 +1 (party) ; nerfer : 2 +1 (party) ; party : 2
    expect(g.power('a1')).toBe(4);
    expect(g.power('buffer')).toBe(3);
    expect(g.power('nerfer')).toBe(3);
    expect(g.power('party')).toBe(2);
    expect(g.power('b5')).toBe(5);
  });

  it('opposite_card : la carte adverse au même emplacement', () => {
    const g = versus(onReveal('opp', { type: 'add_power', target: 'opposite_card', amount: -3 }), [v('b5', 5), v('b4', 4)]);
    expect(g.power('b5')).toBe(2);
    expect(g.power('b4')).toBe(4);
  });

  it('strongest / weakest : égalité → la première posée', () => {
    const g = versus(onReveal('s', { type: 'add_power', target: 'strongest_enemy_here', amount: -1 }), [
      v('x5', 5),
      v('y5', 5),
    ]);
    expect(g.power('x5')).toBe(4);
    expect(g.power('y5')).toBe(5);
  });

  it('random_enemy_here : une seule cible, déterministe', () => {
    const make = () =>
      versus(onReveal('r', { type: 'add_power', target: 'random_enemy_here', amount: -1 }), [v('x5', 5), v('y5', 5)]);
    const a = make();
    const total = a.power('x5')! + a.power('y5')!;
    expect(total).toBe(9);
    expect(make().power('x5')).toBe(a.power('x5'));
  });

  it('hand et deck', () => {
    const cards = [
      onReveal('coach', { type: 'add_power', target: 'hand', amount: 1 }),
      onReveal('saboteur', { type: 'add_power', target: 'deck', side: 'enemy', amount: -1 }),
      v('x', 1),
    ];
    const g = sandbox({ cards, a: ['coach', 'saboteur', 'x'], b: [] });
    g.play([['coach', 0], ['saboteur', 1]]);
    expect(g.card('x').powerMod).toBe(1);
    expect(g.state.players[1].deck.every((uid) => g.state.cards[uid]!.powerMod === -1)).toBe(true);
    g.play([['x', 2]]);
    expect(g.power('x')).toBe(2);
  });

  it('filtre de catégorie', () => {
    const cards = [
      onReveal('dj', { type: 'add_power', target: 'allies_here', filter: { categories: ['musique'] }, amount: 2 }),
      v('singer', 1, { categories: ['musique'] }),
      v('nerd', 1, { categories: ['science'] }),
    ];
    const g = sandbox({ cards, a: ['singer', 'nerd', 'dj'], b: [] });
    g.play([['singer', 0], ['nerd', 0]]).play([['dj', 0]]);
    expect(g.power('singer')).toBe(3);
    expect(g.power('nerd')).toBe(1);
  });
});

describe('actions', () => {
  it('set_power', () => {
    const g = versus(onReveal('setter', { type: 'set_power', target: 'strongest_enemy_here', amount: 1 }), [v('b9', 9)]);
    expect(g.power('b9')).toBe(1);
  });

  it('destroy', () => {
    const g = versus(onReveal('killer', { type: 'destroy', target: 'strongest_enemy_here' }), [v('b2', 2), v('b9', 9)]);
    const b9 = g.card('b9');
    expect(b9.zone).toBe('destroyed');
    expect(g.state.players[1].destroyed).toContain(b9.uid);
    expect(g.state.terrains[0]?.slots[1]).not.toContain(b9.uid);
  });

  it('move : self vers un autre terrain, ou carte adverse vers la droite', () => {
    const g1 = sandbox({ cards: [onReveal('runner', { type: 'move', target: 'self', to: 'random_other' })], a: ['runner'], b: [] });
    g1.play([['runner', 0]]);
    expect([1, 2]).toContain(g1.card('runner').terrain);

    const g2 = versus(onReveal('pusher', { type: 'move', target: 'opposite_card', to: 'right' }), [v('b5', 5)]);
    expect(g2.card('b5').terrain).toBe(1);
    expect(g2.card('b5').controller).toBe(1);
  });

  it('copy : copie (jeton) de la carte adverse dans mon camp', () => {
    const g = versus(onReveal('cloner', { type: 'copy', target: 'opposite_card' }), [v('b5', 5)]);
    const copy = g.card('b5', 0);
    expect(copy.token).toBe(true);
    expect(copy.terrain).toBe(0);
    expect(g.power('b5', 0)).toBe(5);
  });

  it('transform', () => {
    const g = versus(onReveal('morph', { type: 'transform', target: 'opposite_card', into: ['frog'] }), [v('b5', 5)], [v('frog', 1)]);
    expect(g.instances('b5')).toHaveLength(0);
    expect(g.power('frog')).toBe(1);
  });

  it('steal', () => {
    const g = versus(onReveal('thief', { type: 'steal', target: 'opposite_card' }), [v('b5', 5)]);
    expect(g.card('b5').controller).toBe(0);
    expect(g.terrainPowers()[0]).toEqual([7, 0]);
  });

  it('draw', () => {
    const cards = [onReveal('drawer', { type: 'draw', amount: 2 })];
    const g = sandbox({ cards, a: ['drawer'], b: [], rules: { ...SANDBOX_RULES, startingHand: 3 } });
    g.play([['drawer', 0]]); // 4 - 1 + 2, puis pioche du tour 2
    expect(g.state.players[0].hand).toHaveLength(6);
  });

  it('discard : la carte la plus chère de la main adverse', () => {
    const cards = [onReveal('troll', { type: 'discard', amount: 1, side: 'enemy', pick: 'highest_cost' }), v('cheap', 0, { cost: 0 })];
    const g = sandbox({ cards, a: ['troll'], b: ['cheap'] });
    g.play([['troll', 0]]);
    const [discarded] = g.state.players[1].discarded;
    expect(g.state.cards[discarded!]?.defId).toMatch(/^filler_/);
    expect(g.state.players[1].hand).toHaveLength(7); // 7 - 1 + pioche
  });

  it('add_card_to_hand', () => {
    const cards = [onReveal('gen', { type: 'add_card_to_hand', cards: ['frog'] }), v('frog', 1)];
    const g = sandbox({ cards, a: ['gen'], b: [], rules: { ...SANDBOX_RULES, startingHand: 3 } });
    g.play([['gen', 0]]);
    const hand = g.state.players[0].hand.map((u) => g.state.cards[u]!.defId);
    expect(hand).toContain('frog');
  });

  it("hide : face cachée pour l'adversaire, puissance exclue de sa vue, mais comptée", () => {
    const cards = [onReveal('ninja', { type: 'hide', target: 'self' }, 4)];
    const g = sandbox({ cards, a: ['ninja'], b: [] });
    g.play([['ninja', 0]]);
    const opp = getPlayerView(g.ctx, g.state, 1).terrains[0]!;
    expect(opp.cards[0][0]).toMatchObject({ defId: null, power: null, hidden: true });
    expect(opp.power).toEqual([0, 0]);
    expect(getPlayerView(g.ctx, g.state, 0).terrains[0]?.cards[0][0]).toMatchObject({ defId: 'ninja', power: 4 });
    expect(g.terrainPowers()[0]).toEqual([4, 0]);
  });

  it('cancel_effects : toute la carte perd ses effets', () => {
    const grow = v('grow', 2, { keywords: ['croissance'] });
    const g = versus(onReveal('mute', { type: 'cancel_effects', target: 'opposite_card' }), [grow]);
    g.pass();
    expect(g.power('grow')).toBe(3); // +1 à la fin du tour 1 seulement
  });

  it('random_of respecte les poids', () => {
    const g = sandbox({
      cards: [
        onReveal('dice', {
          type: 'random_of',
          weights: [0, 1],
          options: [
            { type: 'add_power', target: 'self', amount: 100 },
            { type: 'add_power', target: 'self', amount: 1 },
          ],
        }),
      ],
      a: ['dice'],
      b: [],
    });
    g.play([['dice', 0]]);
    expect(g.power('dice')).toBe(3);
  });

  it('montant dynamique : +1 par allié ici', () => {
    const cards = [onReveal('crowd', { type: 'add_power', target: 'self', amount: { type: 'count', zone: 'allies_here' } }), v('x', 1), v('y', 1)];
    const g = sandbox({ cards, a: ['x', 'y', 'crowd'], b: [] });
    g.play([['x', 0], ['y', 0]]).play([['crowd', 0]]);
    expect(g.power('crowd')).toBe(4);
  });
});

describe('conditions', () => {
  const musician = onReveal(
    'musician',
    { type: 'add_power', target: 'self', amount: 3 },
    2,
    { condition: { type: 'terrain_has_category', category: 'musique', min: 2 } },
  );
  const m = (id: string) => v(id, 1, { categories: ['musique'] });

  it('exemple du cahier des charges : +3 si le terrain a 2 cartes Musique', () => {
    const g = sandbox({ cards: [musician, m('m1'), m('m2')], a: ['m1', 'musician'], b: ['m2'] });
    g.play([['m1', 0]], [['m2', 0]]).play([['musician', 0]]);
    expect(g.power('musician')).toBe(5);
  });

  it('condition non remplie', () => {
    const g = sandbox({ cards: [musician, m('m1')], a: ['m1', 'musician'], b: [] });
    g.play([['m1', 0]]).play([['musician', 0]]);
    expect(g.power('musician')).toBe(2);
  });

  it('turn, and, not', () => {
    const late = onReveal('late', { type: 'add_power', target: 'self', amount: 5 }, 1, {
      condition: { type: 'and', conditions: [{ type: 'turn', min: 3 }, { type: 'not', condition: { type: 'turn', min: 5 } }] },
    });
    const early = sandbox({ cards: [late], a: ['late'], b: [] }).play([['late', 0]]);
    expect(early.power('late')).toBe(1);
    const mid = sandbox({ cards: [late], a: ['late'], b: [] }).pass(2).play([['late', 0]]);
    expect(mid.power('late')).toBe(6);
  });
});

describe('effets continus et déclencheurs', () => {
  const aura = v('aura', 5, { effects: [{ trigger: 'continuous', action: { type: 'add_power', target: 'allies_here', amount: 2 } }] });

  it("l'aura disparaît quand la source est détruite", () => {
    const g = versus(onReveal('killer', { type: 'destroy', target: 'strongest_enemy_here' }), [aura, v('b1', 1)]);
    expect(g.power('b1')).toBe(1);
  });

  it("l'aura suit la source quand elle change de camp", () => {
    const cards = [aura, v('b1', 1), onReveal('thief', { type: 'steal', target: 'opposite_card' }), v('a1', 1)];
    const g = sandbox({ cards, a: ['a1', 'thief'], b: ['aura', 'b1'] });
    g.play([], [['aura', 0], ['b1', 0]]).play([['thief', 0], ['a1', 0]]);
    expect(g.power('b1')).toBe(1);
    expect(g.power('a1')).toBe(3);
    expect(g.power('thief')).toBe(4);
  });

  it('fin de partie : déclenché avant le décompte', () => {
    const closer = v('closer', 1, { effects: [{ trigger: 'end_of_game', action: { type: 'add_power', target: 'self', amount: 10 } }] });
    const g = sandbox({ cards: [closer, v('b5', 5)], a: ['closer'], b: ['b5'] });
    g.play([['closer', 0]], [['b5', 0]]);
    expect(g.power('closer')).toBe(1);
    g.finish();
    expect(g.state.result?.terrainPowers[0]).toEqual([11, 5]);
  });

  it('début et fin de tour', () => {
    const sot = v('sot', 1, { effects: [{ trigger: 'start_of_turn', action: { type: 'add_power', target: 'self', amount: 2 } }] });
    const eot = v('eot', 1, { effects: [{ trigger: 'end_of_turn', action: { type: 'add_power', target: 'hand', amount: 1 } }] });
    const g = sandbox({ cards: [sot, eot, v('x', 1)], a: ['sot', 'eot', 'x'], b: [] });
    g.play([['sot', 0], ['eot', 1]]);
    expect(g.power('sot')).toBe(3);
    expect(g.card('x').powerMod).toBe(1);
  });
});
