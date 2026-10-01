import type { MatchContext } from '@rabbithole/engine';
import { loadCatalog, type LoadedCatalog } from './catalog';

/**
 * Ce que ce joueur voit du catalogue (sections 9, 10.2 et 14) :
 * - **masquées** : bloquées dans son pays, ou sensibles s'il a coupé le contenu sensible → design neutre ;
 * - **bloquées** : absentes de sa collection et de ses decks ;
 * - **crédits** des images (fiche de carte, page Crédits).
 * Le masquage ne touche que l'affichage : stats et effets restent ceux de la carte.
 */

export interface Credit {
  cardId: string;
  imageUrl: string;
  filePage: string;
  author: string;
  license: string;
  licenseUrl: string | null;
  modified: boolean;
}

export const viewer = $state({
  loaded: false,
  showSensitive: false,
  masked: new Set<string>(),
  blocked: new Set<string>(),
  credits: new Map<string, Credit>(),
});

let pending: Promise<void> | null = null;

/** Charge (ou recharge après un changement de réglage) le filtre et les crédits. */
export function loadViewer(force = false): Promise<void> {
  if (pending && !force) return pending;
  pending = (async () => {
    const [filter, credits] = await Promise.all([
      fetch('/api/content-filter').then((r) => (r.ok ? (r.json() as Promise<{ blocked: string[]; masked: string[]; showSensitive: boolean }>) : null)),
      fetch('/api/credits').then((r) => (r.ok ? (r.json() as Promise<{ credits: Credit[] }>) : null)),
    ]);
    viewer.showSensitive = filter?.showSensitive ?? false;
    viewer.masked = new Set(filter?.masked ?? []);
    viewer.blocked = new Set(filter?.blocked ?? []);
    viewer.credits = new Map((credits?.credits ?? []).map((c) => [c.cardId, c]));
    viewer.loaded = true;
  })().catch(() => {
    pending = null;
  });
  return pending;
}

export const MASKED_NAME = { fr: 'Carte masquée', en: 'Hidden card' };

/** Catalogue d'affichage : les cartes masquées perdent leur nom et leur texte d'ambiance. */
export function maskContext(ctx: MatchContext, masked: ReadonlySet<string>): MatchContext {
  if (masked.size === 0) return ctx;
  const cards = { ...ctx.cards };
  for (const id of masked) {
    const def = cards[id];
    if (def) cards[id] = { ...def, name: MASKED_NAME, flavor: undefined };
  }
  return { ...ctx, cards };
}

export interface ViewerCatalog extends LoadedCatalog {
  blocked: ReadonlySet<string>;
}

/** Catalogue courant (ou d'une version passée) tel que ce joueur doit le voir. */
export async function loadViewerCatalog(version?: string): Promise<ViewerCatalog> {
  const [catalog] = await Promise.all([loadCatalog(version), loadViewer()]);
  return { ...catalog, ctx: maskContext(catalog.ctx, viewer.masked), blocked: new Set(viewer.blocked) };
}
