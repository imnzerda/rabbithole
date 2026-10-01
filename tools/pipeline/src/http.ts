import { USER_AGENT } from './config.js';

/** Appels aux API Wikimedia : identification (User-Agent), délai, reprises, et parallélisme limité. */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class RetryAfter extends Error {
  constructor(readonly ms: number) {
    super(`HTTP 429 (attendre ${ms} ms)`);
  }
}

export async function getJson<T>(url: string, init: RequestInit = {}, retries = 6): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 404) return null as T;
      if (res.status === 429) throw new RetryAfter(Number(res.headers.get('retry-after') ?? 0) * 1000);
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 120)}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt >= retries) throw err;
      // Limite de débit de Wikimedia : on respecte Retry-After, sinon attente exponentielle.
      await sleep(Math.max(err instanceof RetryAfter ? err.ms : 0, 1000 * 2 ** attempt));
    }
  }
}

/** Exécute `fn` sur chaque élément avec au plus `limit` appels en parallèle. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>, onProgress?: (done: number) => void): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
      onProgress?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
