import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardBudget, validateCardDef, type CardDef } from '@rabbithole/engine';
import { describe, expect, it } from 'vitest';

/** Lots de brouillons (`drafts/*.json`), importés dans l'outil d'admin : valides et dans le budget avant import. */
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drafts');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

describe.each(files)('brouillons %s', (file) => {
  const lot = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as { series: string; cards: CardDef[] };

  it('identifiants uniques, préfixés par la série', () => {
    const ids = lot.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith(`${lot.series}_`), id).toBe(true);
  });

  it.each(lot.cards.map((c) => [c.id, c] as const))('%s : valide pour le moteur, dans le budget, textes FR et EN', (_id, card) => {
    expect(validateCardDef(card)).toEqual([]);
    const budget = cardBudget(card);
    expect(budget.verdict, JSON.stringify(budget.lines)).toBe('ok');
    expect(card.name.fr && card.name.en).toBeTruthy();
    expect(card.flavor?.fr && card.flavor?.en).toBeTruthy();
  });
});
