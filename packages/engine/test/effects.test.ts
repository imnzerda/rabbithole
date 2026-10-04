import { describe, expect, it } from 'vitest';
import { EngineError, getPlayerView, type Action, type CardDef, type Effect } from '../src/index.js';
import { card, leader, POOL } from './fixtures.js';
import { sandbox, type Duel } from './helpers.js';

const onPlay = (id: string, action: Action, p: Partial<CardDef> = {}) => card(id, { cost: 0, power: 2, effects: [{ trigger: 'on_play', action }], ...p });

const base: CardDef[] = [
  ...POOL,
  card('weak', { power: 1, cost: 1 }),
  card('mid', { power: 4, cost: 3 }),
  card('big', { power: 7, cost: 6 }),
];

function duel(extra: CardDef[] = [], leaders?: [string, string]): Duel {
  return sandbox({ cards: [...base, ...extra], leaders }).toTurn(3).setBuzz(0, 10);
}

describe('mots-clés « Jouée »', () => {
  it('Rickroll : épuise le Personnage adverse actif le plus fort (coût 5 max)', () => {
    const g = duel().place(1, 'mid').place(1, 'big').give(0, 'p_rickroll');
    g.play(0, 'p_rickroll');
    expect(g.card(1, 'mid').rested).toBe(true);
    expect(g.card(1, 'big').rested).toBe(false); // coût 6 : hors limite
  });

  it('Cancel : le Personnage adverse le plus fort qui a un effet le perd', () => {
    const g = duel().place(1, 'p_aura').place(1, 'big').give(0, 'p_cancel');
    g.play(0, 'p_cancel');
    expect(g.card(1, 'p_aura').effectsCancelled).toBe(true);
    expect(g.card(1, 'big').effectsCancelled).toBe(false);
  });

  it('Séduction : vole le plus faible (coût 2 max), seulement s’il reste de la place', () => {
    const g = duel().place(1, 'weak').place(1, 'mid').give(0, 'p_seduction');
    g.play(0, 'p_seduction');
    expect(g.card(0, 'weak').controller).toBe(0);
    expect(g.card(0, 'weak').playedTurn).toBe(g.state.turn); // ne peut pas attaquer ce tour
  });

  it('Shitpost : un résultat de la table', () => {
    const g = duel().give(0, 'p_shitpost');
    g.play(0, 'p_shitpost');
    expect(g.eventsOf('random_choice')).toHaveLength(1);
  });

  it('Croissance : +1 définitif à chaque fin de tour du contrôleur', () => {
    const g = duel().place(0, 'p_croissance');
    g.end();
    expect(g.power(0, 'p_croissance')).toBe(3);
    g.end();
    expect(g.power(0, 'p_croissance')).toBe(3); // pas à la fin du tour adverse
    g.end();
    expect(g.power(0, 'p_croissance')).toBe(4);
  });

  it('Tendance : +1', () => {
    const g = sandbox({ cards: base, trending: ['mid'] }).toTurn(3).place(0, 'mid');
    expect(g.power(0, 'mid')).toBe(5);
  });
});

describe('actions du DSL', () => {
  it('add_power : durée tour (effacée en fin de tour) et définitive', () => {
    const g = duel([
      onPlay('turnbuff', { type: 'add_power', target: 'allies', amount: 2 }),
      onPlay('permbuff', { type: 'add_power', target: 'my_leader', amount: 1, duration: 'permanent' }),
    ]).place(0, 'mid').give(0, 'turnbuff', 'permbuff');
    g.play(0, 'turnbuff').play(0, 'permbuff');
    expect(g.power(0, 'mid')).toBe(6);
    expect(g.power(0, 'leader')).toBe(6);
    g.end();
    expect(g.power(0, 'mid')).toBe(4);
    expect(g.power(0, 'leader')).toBe(6);
  });

  it('ko / bounce / rest / refresh / steal / cancel_effects', () => {
    const g = duel([
      onPlay('killer', { type: 'ko', target: 'strongest_enemy' }),
      onPlay('bouncer', { type: 'bounce', target: 'weakest_enemy' }),
      onPlay('tapper', { type: 'rest', target: 'enemies' }),
      onPlay('waker', { type: 'refresh', target: 'all_mine' }),
    ])
      .place(1, 'big')
      .place(1, 'weak')
      .place(1, 'mid')
      .give(0, 'killer', 'bouncer', 'tapper', 'waker');
    g.play(0, 'killer');
    expect(g.card(1, 'big').zone).toBe('trash');
    g.play(0, 'bouncer');
    expect(g.card(1, 'weak').zone).toBe('hand');
    g.play(0, 'tapper');
    expect(g.card(1, 'mid').rested).toBe(true);
    g.attack(0, 'leader', 'leader').setLife(1, 4);
    g.play(0, 'waker');
    expect(g.card(0, 'leader').rested).toBe(false);
  });

  it('draw / discard / add_card_to_hand / add_buzz', () => {
    const g = duel([
      onPlay('drawer', { type: 'draw', amount: 2 }),
      onPlay('troll', { type: 'discard', amount: 1, side: 'enemy', pick: 'highest_cost' }),
      onPlay('maker', { type: 'add_card_to_hand', cards: ['p_token'] }),
      onPlay('ramp', { type: 'add_buzz', amount: 1 }),
    ]).give(0, 'drawer', 'troll', 'maker', 'ramp');
    const hand = g.state.players[0].hand.length;
    g.play(0, 'drawer');
    expect(g.state.players[0].hand).toHaveLength(hand - 1 + 2);
    const enemyHand = g.state.players[1].hand.length;
    g.play(0, 'troll');
    expect(g.state.players[1].hand).toHaveLength(enemyHand - 1);
    g.play(0, 'maker');
    expect(g.card(0, 'p_token').zone).toBe('hand');
    const buzz = g.state.players[0].buzzRested;
    g.play(0, 'ramp');
    expect(g.state.players[0].buzzRested).toBe(buzz + 1);
  });

  it('random_of respecte les poids', () => {
    const g = duel([
      onPlay('dice', {
        type: 'random_of',
        weights: [0, 1],
        options: [
          { type: 'draw', amount: 5 },
          { type: 'add_power', target: 'self', amount: 3, duration: 'permanent' },
        ],
      }),
    ]).give(0, 'dice');
    g.play(0, 'dice');
    expect(g.power(0, 'dice')).toBe(5);
  });

  it('montant dynamique et conditions', () => {
    const crowd = onPlay('crowd', { type: 'add_power', target: 'self', amount: { type: 'count', zone: 'allies' }, duration: 'permanent' });
    const g = duel([crowd]).place(0, 'weak').place(0, 'mid').give(0, 'crowd');
    g.play(0, 'crowd');
    expect(g.power(0, 'crowd')).toBe(4);
  });

  it('continu [Ton tour] : actif seulement pendant le tour du contrôleur', () => {
    const g = duel().place(0, 'p_aura').place(0, 'mid');
    expect(g.power(0, 'mid')).toBe(5);
    g.end();
    expect(g.power(0, 'mid')).toBe(4);
  });

  it('[Fin de ton tour] et buzz_attached', () => {
    const vet = card('vet', {
      power: 3,
      effects: [{ trigger: 'continuous', condition: { type: 'buzz_attached', min: 2 }, action: { type: 'add_power', target: 'self', amount: 3 } }],
    });
    const g = duel([vet]).place(0, 'vet').place(0, 'p_end');
    g.act(0, { type: 'attach', target: g.uid(0, 'vet'), amount: 2 });
    expect(g.power(0, 'vet')).toBe(8);
    g.end();
    expect(g.power(0, 'p_end')).toBe(2);
  });
});

describe('capacités de Leader', () => {
  const leaders: CardDef[] = [
    leader('boss', {
      effects: [
        { trigger: 'activate_main', buzzCost: 1, action: { type: 'add_power', target: 'strongest_ally', amount: 2 } } satisfies Effect,
        { trigger: 'on_attack', action: { type: 'add_power', target: 'strongest_enemy', amount: -2 } },
      ],
    }),
  ];

  it('Activation : principale, 1 fois par tour, coût en Buzz', () => {
    const g = sandbox({ cards: [...base, ...leaders], leaders: ['boss', 'leader_b'] }).toTurn(3).setBuzz(0, 2).place(0, 'mid');
    g.act(0, { type: 'activate', uid: g.uid(0, 'leader') });
    expect(g.power(0, 'mid')).toBe(6);
    expect(g.state.players[0].buzzActive).toBe(1);
    expect(() => g.act(0, { type: 'activate', uid: g.uid(0, 'leader') })).toThrow(EngineError);
  });

  it('[Attaque] du Leader', () => {
    const g = sandbox({ cards: [...base, ...leaders], leaders: ['boss', 'leader_b'] }).toTurn(3).place(1, 'mid');
    g.attack(0, 'leader', 'leader');
    expect(g.eventsOf('power_changed').some((e) => e.uid === g.uid(1, 'mid') && e.delta === -2)).toBe(true);
  });
});

describe('Hype et abandon', () => {
  it("Hype : l'enjeu double tout de suite, une fois par joueur, pendant son tour", () => {
    const g = sandbox();
    expect(() => g.act(1, { type: 'hype' })).toThrow(EngineError);
    g.act(0, { type: 'hype' });
    expect(g.state.stake).toBe(2);
    expect(() => g.act(0, { type: 'hype' })).toThrow(EngineError);
    g.end().act(1, { type: 'hype' });
    expect(g.state.stake).toBe(4);
  });

  it("Abandon à tout moment : l'adversaire gagne l'enjeu actuel", () => {
    const g = sandbox();
    g.act(0, { type: 'hype' }).act(1, { type: 'fold' });
    expect(g.state.result).toMatchObject({ winner: 0, reason: 'fold', stake: 2 });
  });
});

describe('vue joueur', () => {
  it("cache la main et les Vies adverses, donne les actions légales au seul décideur", () => {
    const g = sandbox();
    const mine = getPlayerView(g.ctx, g.state, 0);
    const theirs = getPlayerView(g.ctx, g.state, 1);
    expect(mine.me.hand).toHaveLength(5);
    expect(mine.opponent.handCount).toBe(5);
    expect(mine.opponent.life).toBe(4);
    expect(JSON.stringify(mine)).not.toContain(g.state.players[1].hand[0]!);
    expect(JSON.stringify(mine)).not.toContain(g.state.players[1].life[0]!);
    expect(mine.legal?.kind).toBe('main');
    expect(theirs.legal).toBeNull();
  });

  it('pendant un combat : puissances visibles et options de défense', () => {
    const g = sandbox({ cards: [...base, card('cnt', { counter: 2 })] }).toTurn(3).give(1, 'cnt');
    g.attack(0, 'leader', 'leader');
    const v = getPlayerView(g.ctx, g.state, 1);
    expect(v.battle).toMatchObject({ attackerPower: 5, defenderPower: 5 });
    expect(v.legal?.kind).toBe('counter');
    expect(v.legal?.counters.map((o) => o.value)).toContain(2);
  });
});
