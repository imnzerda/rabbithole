import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, simulateMatchup, validateDeck, type CardDef, type LocalizedText } from '@rabbithole/engine';
import { describe, expect, it } from 'vitest';

/**
 * Decks de référence d'une série (`decks/<série>.json`, 10 cartes en 2 exemplaires) :
 * valides, et équilibrés entre eux par simulation IA contre IA (déterministe : mêmes seeds).
 * Une carte modifiée qui fait sortir un deck de la fourchette fait échouer ce test.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cards = readdirSync(join(ROOT, 'drafts'))
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => (JSON.parse(readFileSync(join(ROOT, 'drafts', f), 'utf8')) as { cards: CardDef[] }).cards);
const ctx = createContext({ cards });

interface DeckFile {
  series: string;
  decks: { id: string; name: LocalizedText; leader: string; cards: string[] }[];
}
const files = readdirSync(join(ROOT, 'decks')).filter((f) => f.endsWith('.json'));

describe.each(files)('decks %s', (file) => {
  const data = JSON.parse(readFileSync(join(ROOT, 'decks', file), 'utf8')) as DeckFile;
  const decks = data.decks.map((d) => ({ ...d, deck: d.cards.flatMap((id) => [`${data.series}_${id}`, `${data.series}_${id}`]) }));

  it.each(decks.map((d) => [d.id, d] as const))('%s : deck valide (20 cartes du Leader)', (_id, d) => {
    expect(validateDeck(ctx, d.leader, d.deck)).toEqual([]);
  });

  it('équilibre : chaque deck gagne entre 35 % et 65 % de ses parties', () => {
    const N = 40;
    const wins = new Map<string, number>();
    for (let i = 0; i < decks.length; i++)
      for (let j = i + 1; j < decks.length; j++) {
        const r = simulateMatchup(ctx, decks[i]!, decks[j]!, N, `${data.series}:${i}:${j}`);
        wins.set(decks[i]!.id, (wins.get(decks[i]!.id) ?? 0) + r.winsA);
        wins.set(decks[j]!.id, (wins.get(decks[j]!.id) ?? 0) + r.winsB);
      }
    const rates = Object.fromEntries([...wins].map(([id, w]) => [id, Math.round((w / (N * (decks.length - 1))) * 100)]));
    for (const [id, rate] of Object.entries(rates)) {
      expect(rate, JSON.stringify(rates)).toBeGreaterThanOrEqual(35);
      expect(rate, JSON.stringify(rates)).toBeLessThanOrEqual(65);
    }
  }, 120_000);
});
