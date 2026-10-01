import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, KEYWORDS, keywordText, mergeRules, rulesSummary } from '../src/index.js';

describe('glossaire', () => {
  it('chaque mot-clé a une phrase en français et en anglais', () => {
    for (const k of KEYWORDS) {
      expect(keywordText(DEFAULT_RULES, k, 'fr').length).toBeGreaterThan(10);
      expect(keywordText(DEFAULT_RULES, k, 'en').length).toBeGreaterThan(10);
    }
  });

  it('les chiffres suivent la config', () => {
    expect(keywordText(DEFAULT_RULES, 'ratio')).toBe('La carte adverse la plus forte ici perd 3.');
    expect(keywordText(mergeRules({ keywords: { ratio: { amount: 2 } } }), 'ratio')).toContain('perd 2');
    expect(keywordText(DEFAULT_RULES, 'shitpost')).toBe('Gagne entre +0 et +8 au hasard.');
    expect(keywordText(DEFAULT_RULES, 'elan', 'en')).toBe('+2 if played on turns 1 to 3.');
  });

  it('Shitpost avec une table mixte : texte générique', () => {
    const rules = mergeRules({ keywords: { shitpost: { table: [{ weight: 1, action: { type: 'draw', amount: 1 } }] } } });
    expect(keywordText(rules, 'shitpost')).toBe('Un effet au hasard.');
  });

  it('résumé des règles en 5 lignes', () => {
    const fr = rulesSummary(DEFAULT_RULES);
    expect(fr).toHaveLength(5);
    expect(fr[0]).toContain('2 des 3 terrains');
    expect(fr[4]).toContain('×4');
  });
});
