import { CATEGORIES, validateCatalog, validateDeck } from '@rabbithole/engine';
import { describe, expect, it } from 'vitest';
import { COLLECTIBLE_CARDS, LEADER_CARDS, PROTOTYPE_CARDS, PROTOTYPE_DECKS, prototypeContext } from '../src/index.js';

const ctx = prototypeContext();

describe('contenu du prototype', () => {
  it('catalogue valide (structure, DSL, références)', () => {
    expect(validateCatalog(ctx)).toEqual({});
  });

  it('5 Leaders et 50 cartes : 5 par catégorie (4 Personnages + 1 Événement)', () => {
    expect(LEADER_CARDS).toHaveLength(5);
    expect(COLLECTIBLE_CARDS).toHaveLength(50);
    for (const cat of CATEGORIES) {
      const cards = COLLECTIBLE_CARDS.filter((c) => c.categories.includes(cat));
      expect(cards.filter((c) => c.type === 'character'), cat).toHaveLength(4);
      expect(cards.filter((c) => c.type === 'event'), cat).toHaveLength(1);
    }
  });

  it('les Leaders couvrent les 10 catégories, sans chevauchement', () => {
    const covered = LEADER_CARDS.flatMap((l) => l.categories);
    expect(new Set(covered).size).toBe(10);
    expect(covered).toHaveLength(10);
  });

  it('ids uniques ; nom et texte d’ambiance en français et en anglais', () => {
    expect(new Set(PROTOTYPE_CARDS.map((c) => c.id)).size).toBe(PROTOTYPE_CARDS.length);
    for (const c of PROTOTYPE_CARDS) expect(c.name.fr && c.name.en && c.flavor?.fr && c.flavor?.en, c.id).toBeTruthy();
  });

  it('puissance proche de la courbe de référence (coût → puissance)', () => {
    const reference = (cost: number) => cost + 1;
    for (const c of COLLECTIBLE_CARDS.filter((x) => x.type === 'character')) {
      expect(Math.abs(c.power - reference(c.cost)), c.id).toBeLessThanOrEqual(2);
    }
  });

  it('decks préconstruits valides', () => {
    expect(PROTOTYPE_DECKS).toHaveLength(5);
    for (const d of PROTOTYPE_DECKS) expect(validateDeck(ctx, d.leader, d.cards), d.id).toEqual([]);
  });
});
