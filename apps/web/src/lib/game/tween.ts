import type { Ticker } from 'pixi.js';

type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
} satisfies Record<string, Ease>;

interface Running {
  target: Record<string, number>;
  from: Record<string, number>;
  to: Record<string, number>;
  elapsed: number;
  duration: number;
  ease: Ease;
  resolve: () => void;
}

/** Interpolations minimales pilotées par le ticker PixiJS, avec un facteur de vitesse global. */
export class Tweener {
  private running: Running[] = [];
  /** < 1 = plus rapide. `prefers-reduced-motion` → quasi instantané. */
  speed = 1;

  constructor(ticker: Ticker) {
    ticker.add((t) => this.update(t.deltaMS));
  }

  to(target: object, to: Record<string, number>, ms: number, fn: Ease = ease.outCubic): Promise<void> {
    const obj = target as unknown as Record<string, number>;
    // Une nouvelle interpolation sur les mêmes propriétés remplace l'ancienne.
    for (const r of this.running) {
      if (r.target !== obj) continue;
      for (const key of Object.keys(to)) delete r.to[key];
    }
    const from: Record<string, number> = {};
    for (const key of Object.keys(to)) from[key] = obj[key] as number;
    return new Promise((resolve) => {
      const duration = ms * this.speed;
      if (duration <= 1) {
        Object.assign(obj, to);
        resolve();
        return;
      }
      this.running.push({ target: obj, from, to: { ...to }, elapsed: 0, duration, ease: fn, resolve });
    });
  }

  wait(ms: number): Promise<void> {
    return this.to({ v: 0 }, { v: 1 }, ms, ease.linear);
  }

  private update(dt: number): void {
    const done: Running[] = [];
    for (const r of this.running) {
      r.elapsed += dt;
      const p = Math.min(1, r.elapsed / r.duration);
      const k = r.ease(p);
      for (const key of Object.keys(r.to)) {
        r.target[key] = (r.from[key] as number) + ((r.to[key] as number) - (r.from[key] as number)) * k;
      }
      if (p >= 1) done.push(r);
    }
    if (done.length === 0) return;
    this.running = this.running.filter((r) => !done.includes(r));
    for (const r of done) r.resolve();
  }
}
