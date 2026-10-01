import { CATEGORIES, validateCatalog, validateDeck } from '@rabbithole/engine';
import { describe, expect, it } from 'vitest';
import { COLLECTIBLE_CARDS, PROTOTYPE_DECKS, PROTOTYPE_TERRAINS, prototypeContext } from '../src/index.js';

const ctx = prototypeContext();

describe('contenu du prototype', () => {
  it('catalogue valide (structure, DSL, références)', () => {
    expect(validateCatalog(ctx)).toEqual({});
  });

  it('40 cartes à collectionner, 10 terrains', () => {
    expect(COLLECTIBLE_CARDS).toHaveLength(40);
    expect(PROTOTYPE_TERRAINS).toHaveLength(10);
  });

  it('ids uniques', () => {
    const ids = [...COLLECTIBLE_CARDS.map((c) => c.id), ...PROTOTYPE_TERRAINS.map((t) => t.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('courbe de coût de la section 4.3 (20/25/20/15/12/8 %)', () => {
    const counts = [1, 2, 3, 4, 5, 6].map((cost) => COLLECTIBLE_CARDS.filter((c) => c.cost === cost).length);
    expect(counts).toEqual([8, 10, 8, 6, 5, 3]);
  });

  it('toutes les catégories sont représentées, avec au moins une carte multi-catégorie', () => {
    for (const cat of CATEGORIES) expect(COLLECTIBLE_CARDS.some((c) => c.categories.includes(cat))).toBe(true);
    expect(COLLECTIBLE_CARDS.some((c) => c.categories.length === 2)).toBe(true);
  });

  it('chaque carte a un nom et un texte d’ambiance en français et en anglais', () => {
    for (const c of COLLECTIBLE_CARDS) {
      expect(c.name.fr && c.name.en && c.flavor?.fr && c.flavor?.en, c.id).toBeTruthy();
    }
  });

  it('decks préconstruits valides', () => {
    expect(PROTOTYPE_DECKS.length).toBeGreaterThanOrEqual(4);
    for (const d of PROTOTYPE_DECKS) expect(validateDeck(ctx, d.cards), d.id).toEqual([]);
  });

  it('chaque carte à collectionner apparaît dans au moins un deck', () => {
    const used = new Set(PROTOTYPE_DECKS.flatMap((d) => d.cards));
    expect(COLLECTIBLE_CARDS.filter((c) => !used.has(c.id)).map((c) => c.id)).toEqual([]);
  });
});
