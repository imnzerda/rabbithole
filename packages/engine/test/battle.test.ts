import { describe, expect, it } from 'vitest';
import { EngineError, type CardDef } from '../src/index.js';
import { card, POOL } from './fixtures.js';
import { sandbox, type Duel } from './helpers.js';

const cards: CardDef[] = [
  ...POOL,
  card('weak', { power: 3 }),
  card('mid', { power: 4, cost: 3 }),
  card('big', { power: 6 }),
  card('blk', { power: 6, keywords: ['bloqueur'] }),
  card('cnt', { power: 1, counter: 2 }),
];

/** Tour 3 : le joueur 0 peut attaquer. */
function ready(): Duel {
  return sandbox({ cards }).toTurn(3);
}

/** Remplace la carte Vie du dessus du joueur par une carte donnée. */
function topLife(g: Duel, p: 0 | 1, defId: string): void {
  const top = g.state.players[p].life[0]!;
  g.state.cards[top]!.defId = defId;
}

describe('attaques', () => {
  it("personne n'attaque pendant son premier tour", () => {
    const g = sandbox({ cards });
    expect(() => g.attack(0, 'leader', 'leader')).toThrow(EngineError);
    g.end();
    expect(() => g.attack(1, 'leader', 'leader')).toThrow(EngineError);
  });

  it('Leader contre Leader : puissance égale = touché, la Vie part en main', () => {
    const g = ready();
    const hand = g.state.players[1].hand.length;
    g.attack(0, 'leader', 'leader');
    expect(g.state.players[1].life).toHaveLength(3);
    expect(g.state.players[1].hand).toHaveLength(hand + 1);
    expect(g.card(0, 'leader').rested).toBe(true);
    expect(g.events).toContainEqual(expect.objectContaining({ type: 'battle_resolved', hit: true, attackerPower: 5, defenderPower: 5 }));
  });

  it('attaquant plus faible : rien ne se passe', () => {
    const g = ready().place(0, 'weak');
    g.attack(0, 'weak', 'leader');
    expect(g.state.players[1].life).toHaveLength(4);
  });

  it('un Personnage épuisé peut être mis KO, un Personnage actif ne peut pas être ciblé', () => {
    const g = ready().place(1, 'mid', { rested: true }).place(1, 'weak');
    expect(() => g.attack(0, 'leader', 'weak')).toThrow(/Cible invalide/);
    g.attack(0, 'leader', 'mid');
    expect(g.card(1, 'mid').zone).toBe('trash');
  });

  it('une carte épuisée ne peut pas attaquer ; un Personnage posé ce tour non plus, sauf Élan', () => {
    const g = ready().place(0, 'weak', { fresh: true }).place(0, 'p_elan', { fresh: true });
    expect(() => g.attack(0, 'weak', 'leader')).toThrow(EngineError);
    g.attack(0, 'p_elan', 'leader');
    expect(() => g.attack(0, 'p_elan', 'leader')).toThrow(EngineError);
  });

  it('le Buzz attaché donne +1 pendant son tour seulement', () => {
    const g = ready().place(0, 'weak').setBuzz(0, 2);
    g.act(0, { type: 'attach', target: g.uid(0, 'weak'), amount: 2 });
    expect(g.power(0, 'weak')).toBe(5);
    g.end();
    expect(g.power(0, 'weak')).toBe(3);
  });
});

describe('défense', () => {
  it('Bloqueur : devient la cible et survit si plus fort', () => {
    const g = ready().place(1, 'blk');
    g.attack(0, 'leader', 'leader');
    expect(g.phase).toBe('block');
    g.act(1, { type: 'block', blocker: g.uid(1, 'blk') });
    expect(g.state.players[1].life).toHaveLength(4);
    expect(g.card(1, 'blk').rested).toBe(true);
    expect(g.card(1, 'blk').zone).toBe('field');
    expect(g.phase).toBe('main');
  });

  it('refuser de bloquer, puis Contre depuis la main : +2 sauve le Leader', () => {
    const g = ready().place(1, 'blk').give(1, 'cnt');
    g.attack(0, 'leader', 'leader');
    g.act(1, { type: 'block', blocker: null });
    expect(g.phase).toBe('counter');
    g.act(1, { type: 'counter', uids: [g.uid(1, 'cnt')] });
    expect(g.state.players[1].life).toHaveLength(4);
    expect(g.card(1, 'cnt').zone).toBe('trash');
    expect(g.power(1, 'leader')).toBe(5); // bonus de combat effacé
  });

  it('Événement Contre : coûte du Buzz, sinon il n’est pas proposé', () => {
    const g = ready().give(1, 'e_counter').setBuzz(1, 0);
    g.attack(0, 'leader', 'leader');
    expect(g.phase).toBe('main'); // pas de Buzz → pas d'option de contre
    expect(g.state.players[1].life).toHaveLength(3);

    const h = ready().give(1, 'e_counter').setBuzz(1, 1);
    h.attack(0, 'leader', 'leader');
    h.act(1, { type: 'counter', uids: [h.uid(1, 'e_counter')] });
    expect(h.state.players[1].life).toHaveLength(4);
    expect(h.state.players[1].buzzActive).toBe(0);
  });

  it('contre invalide : refusé', () => {
    const g = ready().give(1, 'cnt');
    g.attack(0, 'leader', 'leader');
    expect(() => g.act(1, { type: 'counter', uids: ['nope'] })).toThrow(EngineError);
  });
});

describe('Vies et Déclencheurs', () => {
  it('Déclencheur activé : effet, puis la carte va à la défausse', () => {
    const g = ready();
    topLife(g, 1, 'p_trigger');
    g.attack(0, 'leader', 'leader');
    expect(g.phase).toBe('trigger');
    expect(g.state.damage?.player).toBe(1);
    g.act(1, { type: 'trigger', activate: true });
    expect(g.card(1, 'p_trigger').zone).toBe('trash');
    expect(g.card(1, 'p_token').zone).toBe('hand');
    expect(g.phase).toBe('main');
  });

  it('Déclencheur refusé : la carte va en main', () => {
    const g = ready();
    topLife(g, 1, 'p_trigger');
    g.attack(0, 'leader', 'leader').act(1, { type: 'trigger', activate: false });
    expect(g.card(1, 'p_trigger').zone).toBe('hand');
  });

  it('Viral : 2 Vies', () => {
    const g = ready().place(0, 'p_viral');
    g.attack(0, 'p_viral', 'leader');
    expect(g.state.players[1].life).toHaveLength(2);
  });

  it('Ratio : la Vie va à la défausse, sans Déclencheur', () => {
    const g = ready().place(0, 'p_ratio');
    topLife(g, 1, 'p_trigger');
    g.act(0, { type: 'attach', target: g.uid(0, 'p_ratio'), amount: 1 });
    g.attack(0, 'p_ratio', 'leader');
    expect(g.phase).toBe('main');
    expect(g.card(1, 'p_trigger').zone).toBe('trash');
  });

  it('touché à 0 Vie : défaite', () => {
    const g = ready().setLife(1, 0);
    g.attack(0, 'leader', 'leader');
    expect(g.state.result).toMatchObject({ winner: 0, reason: 'life' });
    expect(() => g.end()).toThrow(/terminée/);
  });
});

describe('effets de combat', () => {
  it('[Attaque] et [KO]', () => {
    const g = ready().place(0, 'p_attack').place(1, 'p_draw', { rested: true });
    const hand1 = g.state.players[1].hand.length;
    g.attack(0, 'p_attack', 'p_draw');
    // p_attack fait défausser 1 carte, puis p_draw est KO et fait piocher son contrôleur.
    expect(g.state.players[1].hand.length).toBe(hand1);
    expect(g.card(1, 'p_draw').zone).toBe('trash');
    expect(g.eventsOf('card_discarded')).toHaveLength(1);
  });

  it('Clickbait : +2 pendant le combat uniquement', () => {
    const g = ready().place(0, 'p_clickbait');
    g.attack(0, 'p_clickbait', 'leader'); // 2 + 2 = 4 < 5
    expect(g.state.players[1].life).toHaveLength(4);
    expect(g.power(0, 'p_clickbait')).toBe(2);
    expect(g.eventsOf('keyword_triggered').some((e) => e.keyword === 'clickbait')).toBe(true);
  });
});

describe('Événements', () => {
  it('Principale : payé, résolu, défaussé', () => {
    const g = ready().give(0, 'e_ko').setBuzz(0, 3).place(1, 'mid');
    g.play(0, 'e_ko');
    expect(g.card(1, 'mid').zone).toBe('trash');
    expect(g.card(0, 'e_ko').zone).toBe('trash');
    expect(g.state.players[0].buzzActive).toBe(0);
  });

  it('un Événement Contre ne se joue pas en phase principale', () => {
    const g = ready().give(0, 'e_counter').setBuzz(0, 3);
    expect(() => g.play(0, 'e_counter')).toThrow(EngineError);
  });

  it('pas assez de Buzz : refusé', () => {
    const g = ready().give(0, 'e_ko').setBuzz(0, 2);
    expect(() => g.play(0, 'e_ko')).toThrow(EngineError);
  });

  it('5 Personnages maximum', () => {
    const g = ready().place(0, 'weak').place(0, 'weak').place(0, 'mid').place(0, 'mid').place(0, 'big').give(0, 'cnt').setBuzz(0, 5);
    expect(() => g.play(0, 'cnt')).toThrow(EngineError);
  });
});
