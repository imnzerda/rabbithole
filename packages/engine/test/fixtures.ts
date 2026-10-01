import type { CardDef, TerrainDef } from '../src/index.js';

export function card(id: string, p: Partial<CardDef> = {}): CardDef {
  return {
    id,
    name: { fr: id, en: id },
    categories: ['internet'],
    cost: 1,
    power: 2,
    rarity: 'basique',
    series: 'test',
    keywords: [],
    effects: [],
    ...p,
  };
}

/** Cartes de remplissage des decks de test : chères, sans puissance, jamais jouées. */
export const FILLERS: CardDef[] = Array.from({ length: 12 }, (_, i) =>
  card(`filler_${i}`, { cost: 9, power: 0, categories: ['science'] }),
);

export const TERRAINS: TerrainDef[] = [
  { id: 'neutral_1', name: { fr: 'Neutre 1' }, modifiers: [] },
  { id: 'neutral_2', name: { fr: 'Neutre 2' }, modifiers: [] },
  { id: 'neutral_3', name: { fr: 'Neutre 3' }, modifiers: [] },
  {
    id: 'prohibition',
    name: { fr: 'Prohibition', en: 'Prohibition' },
    favoredCategory: 'crimes_scandales',
    modifiers: [{ type: 'power', filter: { categories: ['crimes_scandales'] }, amount: 2 }],
  },
  { id: 'stade', name: { fr: 'Stade', en: 'Stadium' }, favoredCategory: 'sport', modifiers: [{ type: 'elan_always' }] },
  { id: 'las_vegas', name: { fr: 'Las Vegas', en: 'Las Vegas' }, modifiers: [{ type: 'random_twice' }] },
  {
    id: 'tribunal',
    name: { fr: 'Tribunal', en: 'Courtroom' },
    modifiers: [{ type: 'power', filter: { categories: ['crimes_scandales'] }, amount: -2 }],
  },
  {
    id: 'concert',
    name: { fr: 'Concert', en: 'Concert' },
    favoredCategory: 'musique',
    modifiers: [{ type: 'aura', filter: { categories: ['musique'] }, amount: 1 }],
  },
  {
    id: 'serveur_discord',
    name: { fr: 'Serveur Discord', en: 'Discord Server' },
    favoredCategory: 'internet',
    modifiers: [{ type: 'cost', filter: { categories: ['internet'] }, amount: -1 }],
  },
  { id: 'metro_parisien', name: { fr: 'Le métro parisien', en: 'Paris Metro' }, favoredCountry: 'FR', modifiers: [] },
];

/** Pool couvrant tous les mots-clés et toutes les actions, pour les parties aléatoires. */
export const POOL: CardDef[] = [
  card('p_viral', { cost: 2, power: 3, keywords: ['viral'] }),
  card('p_ratio', { cost: 4, power: 7, keywords: ['ratio'] }),
  card('p_cancel', { cost: 3, power: 4, keywords: ['cancel'] }),
  card('p_clickbait', { cost: 1, power: 1, keywords: ['clickbait'] }),
  card('p_rickroll', { cost: 2, power: 3, keywords: ['rickroll'] }),
  card('p_live', { cost: 2, power: 2, keywords: ['croissance'], categories: ['internet', 'musique'] }),
  card('p_shitpost', { cost: 1, power: 1, keywords: ['shitpost'] }),
  card('p_seduction', { cost: 3, power: 3, keywords: ['seduction'], categories: ['nuits_exces'] }),
  card('p_elan', { cost: 1, power: 1, keywords: ['elan'], categories: ['sport'] }),
  card('p_croissance', { cost: 2, power: 1, keywords: ['croissance'], categories: ['exploration'] }),
  card('p_vanilla6', { cost: 6, power: 11, categories: ['guerre_pouvoir'], country: 'FR' }),
  card('p_vanilla3', { cost: 3, power: 5, categories: ['crimes_scandales'] }),
  card('p_music_aura', {
    cost: 3,
    power: 3,
    categories: ['musique'],
    effects: [{ trigger: 'continuous', action: { type: 'add_power', target: 'allies_here', amount: 1 } }],
  }),
  card('p_destroyer', {
    cost: 5,
    power: 5,
    categories: ['crimes_scandales'],
    effects: [{ trigger: 'on_reveal', action: { type: 'destroy', target: 'strongest_enemy_here' } }],
  }),
  card('p_mover', {
    cost: 2,
    power: 3,
    categories: ['mysteres'],
    effects: [{ trigger: 'on_reveal', action: { type: 'move', target: 'random_enemy_here', to: 'random_other' } }],
  }),
  card('p_copycat', {
    cost: 3,
    power: 2,
    categories: ['series_cinema'],
    effects: [{ trigger: 'on_reveal', action: { type: 'copy', target: 'opposite_card', to: 'here' } }],
  }),
  card('p_transformer', {
    cost: 4,
    power: 4,
    categories: ['series_cinema'],
    effects: [{ trigger: 'on_reveal', action: { type: 'transform', target: 'weakest_enemy_here', into: ['p_token'] } }],
  }),
  card('p_thief', {
    cost: 4,
    power: 3,
    categories: ['crimes_scandales'],
    effects: [{ trigger: 'end_of_game', action: { type: 'steal', target: 'opposite_card' } }],
  }),
  card('p_scientist', {
    cost: 2,
    power: 2,
    categories: ['science'],
    effects: [
      { trigger: 'on_reveal', action: { type: 'draw', amount: 1 } },
      { trigger: 'on_reveal', action: { type: 'add_card_to_hand', cards: ['p_token'] } },
    ],
  }),
  card('p_hider', {
    cost: 2,
    power: 4,
    categories: ['mysteres'],
    effects: [
      { trigger: 'on_reveal', action: { type: 'hide', target: 'self' } },
      { trigger: 'on_reveal', action: { type: 'discard', amount: 1, side: 'enemy' } },
    ],
  }),
  card('p_gambler', {
    cost: 3,
    power: 3,
    categories: ['mysteres'],
    effects: [
      {
        trigger: 'on_reveal',
        action: {
          type: 'random_of',
          options: [
            { type: 'add_power', target: 'self', amount: 4 },
            { type: 'set_power', target: 'random_enemy_here', amount: 1 },
            { type: 'cancel_effects', target: 'enemies_here' },
          ],
        },
      },
    ],
  }),
  card('p_grower', {
    cost: 1,
    power: 1,
    categories: ['exploration'],
    effects: [{ trigger: 'end_of_turn', action: { type: 'add_power', target: 'hand', amount: 1 } }],
  }),
  card('p_musician', {
    cost: 2,
    power: 2,
    categories: ['musique'],
    effects: [
      {
        trigger: 'on_reveal',
        condition: { type: 'terrain_has_category', category: 'musique', min: 2 },
        action: { type: 'add_power', target: 'self', amount: 3 },
      },
    ],
  }),
  card('p_token', { cost: 1, power: 1, categories: ['internet'] }),
];
