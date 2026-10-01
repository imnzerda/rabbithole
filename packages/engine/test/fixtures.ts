import type { CardDef } from '../src/index.js';

/** Personnage de test (catégorie Internet par défaut). */
export function card(id: string, p: Partial<CardDef> = {}): CardDef {
  return {
    id,
    type: 'character',
    name: { fr: id, en: id },
    categories: ['internet'],
    cost: 1,
    power: 2,
    counter: 0,
    rarity: 'basique',
    series: 'test',
    keywords: [],
    effects: [],
    ...p,
  };
}

export function leader(id: string, p: Partial<CardDef> = {}): CardDef {
  return card(id, { type: 'leader', categories: ['internet', 'science'], cost: 0, power: 5, life: 4, counter: undefined, ...p });
}

export function event(id: string, p: Partial<CardDef> = {}): CardDef {
  return card(id, { type: 'event', power: 0, counter: undefined, ...p });
}

export const LEADERS: CardDef[] = [leader('leader_a'), leader('leader_b')];

/** Cartes de remplissage : chères, sans puissance, jamais jouées (catégorie Science, compatible avec les Leaders de test). */
export const FILLERS: CardDef[] = Array.from({ length: 10 }, (_, i) =>
  card(`filler_${i}`, { cost: 9, power: 0, categories: ['science'] }),
);

/** Pool couvrant tous les mots-clés, déclencheurs et actions, pour les parties aléatoires. */
export const POOL: CardDef[] = [
  card('p_elan', { cost: 2, power: 3, keywords: ['elan'], counter: 1 }),
  card('p_bloqueur', { cost: 2, power: 3, keywords: ['bloqueur'], counter: 1 }),
  card('p_viral', { cost: 4, power: 5, keywords: ['viral'] }),
  card('p_ratio', { cost: 3, power: 4, keywords: ['ratio'], counter: 1 }),
  card('p_clickbait', { cost: 1, power: 2, keywords: ['clickbait'], counter: 2 }),
  card('p_croissance', { cost: 2, power: 2, keywords: ['croissance'], counter: 1 }),
  card('p_rickroll', { cost: 3, power: 3, keywords: ['rickroll'], counter: 1 }),
  card('p_cancel', { cost: 3, power: 4, keywords: ['cancel'] }),
  card('p_seduction', { cost: 4, power: 4, keywords: ['seduction'] }),
  card('p_shitpost', { cost: 1, power: 1, keywords: ['shitpost'], counter: 2 }),
  card('p_vanilla', { cost: 5, power: 7 }),
  card('p_aura', {
    cost: 4,
    power: 4,
    effects: [{ trigger: 'continuous', condition: { type: 'my_turn' }, action: { type: 'add_power', target: 'allies', amount: 1 } }],
  }),
  card('p_ko', { cost: 6, power: 6, effects: [{ trigger: 'on_play', action: { type: 'ko', target: 'strongest_enemy', filter: { maxCost: 4 } } }] }),
  card('p_bounce', { cost: 3, power: 3, effects: [{ trigger: 'on_play', action: { type: 'bounce', target: 'random_enemy' } }] }),
  card('p_draw', {
    cost: 2,
    power: 2,
    counter: 1,
    categories: ['science'],
    effects: [{ trigger: 'on_ko', action: { type: 'draw', amount: 1 } }],
  }),
  card('p_attack', {
    cost: 3,
    power: 4,
    effects: [{ trigger: 'on_attack', action: { type: 'discard', amount: 1, side: 'enemy' } }],
  }),
  card('p_trigger', {
    cost: 2,
    power: 3,
    counter: 1,
    effects: [{ trigger: 'on_trigger', action: { type: 'add_card_to_hand', cards: ['p_token'] } }],
  }),
  card('p_buzz', { cost: 2, power: 2, effects: [{ trigger: 'on_play', action: { type: 'add_buzz', amount: 1 } }] }),
  card('p_end', { cost: 1, power: 3, counter: 1, effects: [{ trigger: 'end_of_turn', action: { type: 'add_power', target: 'self', amount: -1, duration: 'permanent' } }] }),
  event('e_ko', {
    cost: 3,
    effects: [
      { trigger: 'main', action: { type: 'ko', target: 'strongest_enemy', filter: { maxCost: 3 } } },
      { trigger: 'on_trigger', action: { type: 'rest', target: 'strongest_enemy' } },
    ],
  }),
  event('e_counter', { cost: 1, effects: [{ trigger: 'counter', action: { type: 'add_power', target: 'battle_target', amount: 3, duration: 'battle' } }] }),
  event('e_random', {
    cost: 1,
    effects: [
      {
        trigger: 'main',
        action: {
          type: 'random_of',
          options: [
            { type: 'draw', amount: 1 },
            { type: 'refresh', target: 'strongest_ally' },
            { type: 'cancel_effects', target: 'strongest_enemy' },
            { type: 'steal', target: 'weakest_enemy', filter: { maxCost: 1 } },
          ],
        },
      },
    ],
  }),
  card('p_token', { cost: 1, power: 2, counter: 1 }),
];
