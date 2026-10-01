/**
 * PRNG déterministe (xoshiro128**), état sérialisable dans l'état de partie.
 * La seed vient du serveur (crypto) ; ce générateur sert uniquement à rejouer
 * la partie à l'identique à partir de cette seed. Aucun `Math.random` dans le moteur.
 */
export type RngState = [number, number, number, number];

function hashSeed(seed: string): RngState {
  // cyrb128
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  const state: RngState = [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  if (state.every((v) => v === 0)) state[0] = 0x9e3779b9;
  return state;
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

export class Rng {
  private s: RngState;

  private constructor(state: RngState) {
    this.s = [...state];
  }

  static fromSeed(seed: string): Rng {
    return new Rng(hashSeed(seed));
  }

  static fromState(state: RngState): Rng {
    return new Rng(state);
  }

  getState(): RngState {
    return [...this.s];
  }

  /** Entier non signé sur 32 bits. */
  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Entier uniforme dans [0, n). */
  int(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new RangeError(`Rng.int: n invalide (${n})`);
    const limit = Math.floor(0x100000000 / n) * n;
    let x: number;
    do {
      x = this.nextU32();
    } while (x >= limit);
    return x % n;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: liste vide');
    return items[this.int(items.length)] as T;
  }

  /** Index tiré selon des poids entiers positifs. */
  weighted(weights: readonly number[]): number {
    const total = weights.reduce((a, w) => a + w, 0);
    if (!Number.isInteger(total) || total <= 0) throw new RangeError('Rng.weighted: poids invalides');
    let roll = this.int(total);
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i] as number;
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }

  /** Mélange Fisher-Yates en place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }
}
