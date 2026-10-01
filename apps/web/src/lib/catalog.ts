import { createContext, type MatchContext } from '@rabbithole/engine';
import type { CatalogDto } from '@rabbithole/shared';

/** Catalogue publié par le serveur (qui fait foi) : cartes, règles, cartes à collectionner. */
export interface LoadedCatalog {
  version: string;
  ctx: MatchContext;
  /** Leaders et cartes à collectionner (hors jetons). */
  collectible: Set<string>;
}

const cache = new Map<string, Promise<LoadedCatalog>>();

async function fetchCatalog(path: string): Promise<LoadedCatalog> {
  const res = await fetch(`/api/catalog${path}`);
  if (!res.ok) throw new Error(`catalogue ${res.status}`);
  const dto = (await res.json()) as CatalogDto;
  return { version: dto.version, ctx: createContext({ cards: dto.cards, rules: dto.rules }), collectible: new Set(dto.collectible) };
}

/**
 * Catalogue courant, ou celui d'une version passée (replays).
 * Une version donnée ne change jamais : elle reste en cache. Le catalogue courant est relu à chaque page.
 */
export function loadCatalog(version?: string): Promise<LoadedCatalog> {
  if (!version) {
    const current = fetchCatalog('');
    void current.then((c) => cache.set(c.version, Promise.resolve(c)), () => {});
    return current;
  }
  let hit = cache.get(version);
  if (!hit) {
    hit = fetchCatalog(`/${encodeURIComponent(version)}`);
    hit.catch(() => cache.delete(version));
    cache.set(version, hit);
  }
  return hit;
}
