import { describe, expect, it } from 'vitest';
import { Rng } from '../src/index.js';

const seq = (rng: Rng, n: number) => Array.from({ length: n }, () => rng.nextU32());

describe('Rng', () => {
  it('produit la même séquence pour la même seed', () => {
    expect(seq(Rng.fromSeed('abc'), 100)).toEqual(seq(Rng.fromSeed('abc'), 100));
  });

  it('produit des séquences différentes pour des seeds différentes', () => {
    expect(seq(Rng.fromSeed('abc'), 10)).not.toEqual(seq(Rng.fromSeed('abd'), 10));
  });

  it("reprend exactement à partir d'un état sérialisé", () => {
    const a = Rng.fromSeed('x');
    seq(a, 17);
    const b = Rng.fromState(JSON.parse(JSON.stringify(a.getState())));
    expect(seq(a, 50)).toEqual(seq(b, 50));
  });

  it('ne produit que des entiers non signés 32 bits', () => {
    for (const v of seq(Rng.fromSeed('u32'), 1000)) {
      expect(Number.isInteger(v) && v >= 0 && v < 2 ** 32).toBe(true);
    }
  });

  it('int(n) reste dans les bornes et est à peu près uniforme', () => {
    const rng = Rng.fromSeed('uniform');
    const buckets = new Array<number>(6).fill(0);
    for (let i = 0; i < 12000; i++) buckets[rng.int(6)]!++;
    for (const b of buckets) expect(b).toBeGreaterThan(1800), expect(b).toBeLessThan(2200);
  });

  it('rejette les bornes invalides', () => {
    const rng = Rng.fromSeed('err');
    expect(() => rng.int(0)).toThrow();
    expect(() => rng.pick([])).toThrow();
    expect(() => rng.weighted([0, 0])).toThrow();
  });

  it('weighted ne tire jamais un poids nul', () => {
    const rng = Rng.fromSeed('w');
    for (let i = 0; i < 500; i++) expect(rng.weighted([0, 3, 0, 1])).not.toBe(0);
  });

  it('shuffle produit une permutation déterministe', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const a = Rng.fromSeed('s').shuffle([...items]);
    const b = Rng.fromSeed('s').shuffle([...items]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toEqual(items);
  });
});
