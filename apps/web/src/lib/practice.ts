import { PROTOTYPE_DECKS, prototypeContext, type PrebuiltDeck } from '@rabbithole/content';
import type { MatchContext } from '@rabbithole/engine';
import { loadViewerCatalog } from './viewer.svelte';

/**
 * Entraînement contre l'IA : les decks de référence de la série publiée (cartes réelles), servis par
 * le serveur ; à défaut (aucune série publiée, serveur injoignable), le contenu embarqué du prototype.
 * Rien n'est enregistré : l'entraînement n'a aucun enjeu.
 */
export interface PracticeSetup {
  ctx: MatchContext;
  decks: PrebuiltDeck[];
}

let cached: Promise<PracticeSetup> | null = null;

async function fetchPractice(): Promise<PracticeSetup> {
  try {
    const [res, catalog] = await Promise.all([fetch('/api/decks/reference'), loadViewerCatalog()]);
    if (res.ok) {
      const { decks } = (await res.json()) as { decks: (PrebuiltDeck & { series: string })[] };
      const fromSeries = decks.filter((d) => d.series !== 'prototype');
      const chosen = fromSeries.length ? fromSeries : decks;
      if (chosen.length) return { ctx: catalog.ctx, decks: chosen };
    }
  } catch {
    // Serveur injoignable : entraînement hors ligne avec le prototype.
  }
  return { ctx: prototypeContext(), decks: PROTOTYPE_DECKS };
}

export function loadPractice(): Promise<PracticeSetup> {
  cached ??= fetchPractice().catch((err: unknown) => {
    cached = null;
    throw err;
  });
  return cached;
}
