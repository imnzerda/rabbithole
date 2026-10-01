import { describe, expect, it } from 'vitest';
import cards from '../../content/data/prototype/cards.json';
import { actionValue, cardBudget, catalogBudget, effectValue } from '../src/budget.js';
import { DEFAULT_BUDGET } from '../src/rules.js';
import type { CardDef } from '../src/types.js';

const character = (over: Partial<CardDef> = {}): CardDef => ({
  id: 't',
  type: 'character',
  name: { fr: 'Test' },
  categories: ['sport'],
  cost: 3,
  power: 4,
  counter: 1,
  rarity: 'basique',
  series: 'test',
  keywords: [],
  effects: [],
  ...over,
});

describe('budget de puissance (section 3.9)', () => {
  it('référence : puissance ≈ coût + 1 pour un Personnage sans effet avec Contre 1', () => {
    for (let cost = 1; cost <= 8; cost++) {
      expect(cardBudget(character({ cost, power: cost + 1 })).delta, `coût ${cost}`).toBe(0);
    }
  });

  it('sans Contre : +1 de puissance ; Contre 2 : −1', () => {
    expect(cardBudget(character({ counter: 0, power: 5 })).delta).toBe(0);
    expect(cardBudget(character({ counter: 2, power: 3 })).delta).toBe(0);
  });

  it('mots-clés et effets se paient en puissance ; au-delà de la tolérance, la carte est signalée', () => {
    const viral = cardBudget(character({ keywords: ['viral'], power: 4 }));
    expect(viral.expected).toBe(4 - DEFAULT_BUDGET.keywords.viral!);
    expect(viral.verdict).toBe('strong');
    const ko = cardBudget(character({ power: 1, effects: [{ trigger: 'on_play', action: { type: 'ko', target: 'strongest_enemy' } }] }));
    expect(ko.expected).toBe(1);
    expect(ko.verdict).toBe('ok');
    expect(cardBudget(character({ power: 1 })).verdict).toBe('weak');
  });

  it('un inconvénient rend de la puissance ; un malus sur l’adversaire est un avantage', () => {
    expect(actionValue({ type: 'add_power', target: 'self', amount: -1, duration: 'permanent' })).toBeLessThan(0);
    expect(actionValue({ type: 'add_power', target: 'strongest_enemy', amount: -2, duration: 'turn' })).toBeGreaterThan(0);
    expect(actionValue({ type: 'draw', amount: 1, side: 'enemy' })).toBeLessThan(0);
  });

  it('moment, condition, coût d’activation, ciblage multiple, coût maximum', () => {
    const draw = { type: 'draw', amount: 1 } as const;
    expect(effectValue({ trigger: 'continuous', action: { type: 'add_power', target: 'allies', amount: 1 } })).toBeGreaterThan(effectValue({ trigger: 'on_play', action: { type: 'add_power', target: 'allies', amount: 1 } }));
    expect(effectValue({ trigger: 'on_play', action: draw, condition: { type: 'my_turn' } })).toBeLessThan(effectValue({ trigger: 'on_play', action: draw }));
    expect(effectValue({ trigger: 'activate_main', action: draw, buzzCost: 1 })).toBeLessThan(effectValue({ trigger: 'activate_main', action: draw }));
    expect(actionValue({ type: 'ko', target: 'strongest_enemy', filter: { maxCost: 2 } })).toBeLessThan(actionValue({ type: 'ko', target: 'strongest_enemy' }));
    expect(actionValue({ type: 'rest', target: 'enemies' })).toBe(2 * actionValue({ type: 'rest', target: 'strongest_enemy' }));
  });

  it('Événement : la valeur des effets suit le coût ; Leader : pour information', () => {
    const event = cardBudget(character({ type: 'event', power: 0, cost: 1, counter: 0, effects: [{ trigger: 'counter', action: { type: 'add_power', target: 'battle_target', amount: 2, duration: 'battle' } }] }));
    expect(event.verdict).toBe('ok');
    const leader = cardBudget(character({ type: 'leader', cost: 0, power: 5, life: 4 }));
    expect(leader).toMatchObject({ reference: 0, delta: 0, verdict: 'ok' });
  });

  it('calibré sur le prototype (équilibré par simulation) : au moins 85 % des cartes dans la norme, aucune à plus de 2 points', () => {
    const report = catalogBudget(cards as CardDef[]);
    const ok = report.filter((r) => r.report.verdict === 'ok').length;
    expect(ok / report.length).toBeGreaterThanOrEqual(0.85);
    expect(Math.abs(report[0]!.report.delta)).toBeLessThanOrEqual(2);
    // Trié du plus hors norme au moins hors norme.
    expect(Math.abs(report[0]!.report.delta)).toBeGreaterThanOrEqual(Math.abs(report.at(-1)!.report.delta));
  });
});
