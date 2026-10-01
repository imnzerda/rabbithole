import { GENERATION_YEAR, ICONIC_PERCENTILE, SCORE_WEIGHTS, SERIES_RULES } from './config.js';
import type { Candidate, RunFile } from './types.js';

/**
 * Score de notoriété (section 4.6), de 0 à 100 :
 * - portée internationale (30 %) : nombre d'éditions de Wikipédia (sitelinks) ;
 * - popularité (50 %) : vues des 12 derniers mois, toutes langues suivies ;
 * - pertinence générationnelle (20 %) : activité depuis 1990 et tendance des vues sur 5 ans.
 * Chaque critère devient un percentile dans le lot, puis les percentiles sont pondérés.
 */

export const yearOf = (date: string | null): number | null => (date ? Number(/^-?\d+/.exec(date)?.[0]) : null);

/** Percentile de chaque valeur dans la liste (0-100, ex æquo au milieu). */
export function percentiles(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const below = (x: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const above = (x: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return values.map((x) => (n <= 1 ? 100 : ((below(x) + (above(x) - below(x) - 1) / 2) / (n - 1)) * 100));
}

/** Le sujet a-t-il été actif (ou a-t-il eu lieu) depuis 1990 ? 1 = oui, 0 = non, 0,5 = inconnu. */
export function activeSince(c: Candidate, year = GENERATION_YEAR, now = new Date()): number {
  if (c.kind === 'person') {
    const endYear = yearOf(c.death) ?? now.getUTCFullYear();
    return endYear >= year ? 1 : 0;
  }
  const y = yearOf(c.end) ?? yearOf(c.start);
  if (y === null) return 0.5;
  return y >= year ? 1 : 0;
}

/** Pertinence générationnelle brute : activité récente + tendance (vues de l'an dernier / moyenne annuelle sur 5 ans). */
export function generationRaw(c: Candidate, now = new Date()): number {
  const v = c.views;
  const yearlyAvg = v && v.last60Months > 0 ? v.last60Months / 5 : 0;
  const trend = yearlyAvg > 0 ? Math.min(2, v!.last12Months / yearlyAvg) / 2 : 0;
  return 0.5 * activeSince(c, GENERATION_YEAR, now) + 0.5 * trend;
}

/**
 * Score de chaque candidat, rangé dans sa catégorie principale (les catégories n'ont pas la même
 * notoriété : un footballeur et un explorateur ne se comparent pas). Les GOAT potentielles
 * (« iconiques ») sont le top 1 % de tout le lot.
 */
export function scoreRun(run: RunFile, now = new Date()): void {
  const list = run.candidates;
  if (list.length === 0) return;
  const raw = new Map<Candidate, number>();
  const groups = new Map<string, Candidate[]>();
  for (const c of list) {
    const key = c.categories[0] ?? 'autre';
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const rules = SERIES_RULES[run.seriesType];
  const parts = new Map<Candidate, { reach: number; popularity: number; generation: number }>();
  for (const group of groups.values()) {
    const reach = percentiles(group.map((c) => c.sitelinks));
    const popularity = percentiles(group.map((c) => c.views?.last12Months ?? 0));
    const generation = percentiles(group.map((c) => generationRaw(c, now)));
    group.forEach((c, i) => {
      parts.set(c, { reach: reach[i]!, popularity: popularity[i]!, generation: generation[i]! });
      raw.set(c, SCORE_WEIGHTS.reach * reach[i]! + SCORE_WEIGHTS.popularity * popularity[i]! + SCORE_WEIGHTS.generation * generation[i]!);
    });
    const ranked = percentiles(group.map((c) => raw.get(c)!));
    group.forEach((c, i) => {
      const p = parts.get(c)!;
      const total = Math.round(ranked[i]! * 10) / 10;
      c.score = {
        total,
        reach: Math.round(p.reach),
        popularity: Math.round(p.popularity),
        generation: Math.round(p.generation),
        iconic: false,
        meetsThreshold: total >= rules.minScore && c.sitelinks >= rules.minSitelinks,
      };
    });
  }
  // Iconiques : top 1 % de tout le lot (portée et popularité, toutes catégories confondues).
  const reachAll = percentiles(list.map((c) => c.sitelinks));
  const popularityAll = percentiles(list.map((c) => c.views?.last12Months ?? 0));
  const overall = percentiles(list.map((_, i) => SCORE_WEIGHTS.reach * reachAll[i]! + SCORE_WEIGHTS.popularity * popularityAll[i]!));
  list.forEach((c, i) => {
    if (c.score) c.score.iconic = overall[i]! >= ICONIC_PERCENTILE;
  });
}
