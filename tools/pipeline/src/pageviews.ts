import { PAGEVIEW_LANGUAGES } from './config.js';
import { getJson } from './http.js';
import type { Candidate } from './types.js';

/** Vues mensuelles (API Pageviews de Wikimedia, données depuis juillet 2015). */

const BASE = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article';

const stamp = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}0100`;

/** Fenêtre des 60 derniers mois complets avant `now`. */
export function window60(now: Date): { start: string; end: string; cut12: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 59, 1));
  const cut12 = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  return { start: stamp(start), end: stamp(end), cut12: stamp(cut12) };
}

/** Additionne les vues mensuelles : 12 derniers mois et 60 derniers mois. */
export function sumViews(items: { timestamp: string; views: number }[], cut12: string): { last12: number; last60: number } {
  let last12 = 0;
  let last60 = 0;
  for (const it of items) {
    last60 += it.views;
    if (it.timestamp >= cut12) last12 += it.views;
  }
  return { last12, last60 };
}

async function articleViews(lang: string, title: string, w: ReturnType<typeof window60>): Promise<{ last12: number; last60: number }> {
  const article = encodeURIComponent(title.replaceAll(' ', '_'));
  const json = await getJson<{ items?: { timestamp: string; views: number }[] } | null>(
    `${BASE}/${lang}.wikipedia/all-access/user/${article}/monthly/${w.start}/${w.end}`,
  );
  return sumViews(json?.items ?? [], w.cut12);
}

/** Vues toutes langues suivies confondues (section 4.6 : popularité et tendance). */
export async function candidateViews(c: Candidate, now: Date): Promise<NonNullable<Candidate['views']>> {
  const w = window60(now);
  const byLanguage: Record<string, number> = {};
  let last12Months = 0;
  let last60Months = 0;
  for (const lang of PAGEVIEW_LANGUAGES) {
    const title = c.wikis[lang];
    if (!title) continue;
    const v = await articleViews(lang, title, w);
    byLanguage[lang] = v.last12;
    last12Months += v.last12;
    last60Months += v.last60;
  }
  return { last12Months, last60Months, byLanguage };
}
