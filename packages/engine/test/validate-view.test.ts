import { describe, expect, it } from 'vitest';
import {
  createContext,
  getPlayerView,
  validateCardDef,
  validateCatalog,
  validateTerrainDef,
  type CardDef,
} from '../src/index.js';
import { card, FILLERS, POOL, TERRAINS } from './fixtures.js';
import { sandbox } from './helpers.js';

describe('validation de contenu', () => {
  it('le pool de test et les terrains sont valides', () => {
    expect(validateCatalog(createContext({ cards: [...POOL, ...FILLERS], terrains: TERRAINS }))).toEqual({});
  });

  it('exemple de carte du cahier des charges', () => {
    const napoleon: CardDef = {
      id: 'fr_0042',
      wikidataId: 'Q517',
      name: { fr: 'Napoléon Ier', en: 'Napoleon' },
      categories: ['guerre_pouvoir'],
      cost: 5,
      power: 7,
      rarity: 'viral',
      series: 'base',
      country: 'FR',
      keywords: ['croissance'],
      effects: [
        {
          trigger: 'on_reveal',
          condition: { type: 'terrain_has_category', category: 'musique', min: 2 },
          action: { type: 'add_power', target: 'self', amount: 3 },
        },
      ],
      flavor: { fr: "Petit, mais a quand même ratio toute l'Europe." },
      flags: { adult: false, politicallySensitive: false },
      image: { assetId: 'img_8812', fallback: false },
    };
    expect(validateCardDef(napoleon)).toEqual([]);
  });

  it('détecte les erreurs de structure', () => {
    const bad = card('bad', {
      cost: -1,
      power: 1.5,
      rarity: 'mythique' as CardDef['rarity'],
      categories: ['sport', 'musique', 'internet'],
      keywords: ['tendance', 'yolo' as CardDef['keywords'][number]],
      effects: [
        { trigger: 'continuous', action: { type: 'destroy', target: 'self' } },
        { trigger: 'continuous', action: { type: 'add_power', target: 'random_enemy_here', amount: 1 } },
        { trigger: 'on_reveal', action: { type: 'random_of', options: [] } },
        { trigger: 'on_reveal', action: { type: 'move', target: 'hand', to: 'left' } },
      ],
    });
    const errors = validateCardDef(bad).join('\n');
    for (const fragment of [
      'cost',
      'power',
      'rarity',
      '1 ou 2 catégories',
      'automatiquement',
      'yolo',
      'continu ne peut être que add_power',
      'interdite pour un effet continu',
      'options vide',
      'ne vise que le plateau',
    ]) {
      expect(errors).toContain(fragment);
    }
  });

  it('détecte les références à des cartes inconnues', () => {
    const ctx = createContext({
      cards: [card('maker', { effects: [{ trigger: 'on_reveal', action: { type: 'add_card_to_hand', cards: ['ghost'] } }] })],
      terrains: [],
    });
    expect(validateCatalog(ctx)['card:maker']?.[0]).toContain('ghost');
  });

  it('valide les terrains', () => {
    expect(validateTerrainDef({ id: 't', name: { fr: 't' }, modifiers: [{ type: 'power', amount: 1.5 }] })).toHaveLength(1);
  });
});

describe('vue joueur', () => {
  it("ne révèle ni la main ni la pioche de l'adversaire", () => {
    const g = sandbox({ cards: [], a: [], b: [] });
    const view = getPlayerView(g.ctx, g.state, 0);
    expect(view.hand).toHaveLength(7);
    expect(view.hand[0]).toMatchObject({ cost: 9, power: 0 });
    expect(view.opponentHandCount).toBe(7);
    expect(view.opponentDeckCount).toBe(5);
    expect(JSON.stringify(view)).not.toContain(g.state.players[1].hand[0]!);
  });

  it('masque les terrains non révélés', () => {
    const g = sandbox({ cards: [], a: [], b: [], rules: {} });
    expect(getPlayerView(g.ctx, g.state, 1).terrains.map((t) => t.defId)).toEqual(['neutral_1', null, null]);
  });
});
