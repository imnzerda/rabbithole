import { PAGEVIEW_LANGUAGES } from './config.js';
import { chunk, getJson } from './http.js';
import type { Candidate } from './types.js';

/**
 * Vues Wikipédia des 60 derniers jours, par lots de 50 articles (API MediaWiki, extension PageViewInfo).
 *
 * L'API REST « par article » (12 mois, 5 ans) est trop limitée en débit pour des milliers de sujets
 * (une requête par article et par langue, refusées en HTTP 429). Ici : une requête pour 50 articles,
 * soit environ 75 requêtes par langue pour 3 700 sujets. La popularité annuelle est extrapolée
 * à partir des 60 jours (écart au cahier des charges, section 4.6, documenté dans le README).
 */

export const PAGEVIEW_DAYS = 60;

interface PageviewsResponse {
  query?: { pages?: { title: string; pageviews?: Record<string, number | null> }[]; normalized?: { from: string; to: string }[] };
  /** L'API ne renvoie les vues que d'une partie des articles : la suite s'obtient avec `continue`. */
  continue?: Record<string, string>;
}

/** Somme des vues quotidiennes (jours sans donnée = 0). */
export function sumDaily(pageviews: Record<string, number | null> | undefined): number {
  return Object.values(pageviews ?? {}).reduce<number>((s, v) => s + (v ?? 0), 0);
}

/** Vues des 60 derniers jours pour une liste de titres d'une même langue. */
export async function languageViews(lang: string, titles: string[], pause = 300): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const part of chunk([...new Set(titles)], 50)) {
    const normalized = new Map<string, string>();
    const byTitle = new Map<string, number>();
    let cont: Record<string, string> = {};
    // Les vues arrivent par morceaux (ordre alphabétique) : on suit `continue` jusqu'au bout.
    for (let page = 0; page < 50; page++) {
      const url = `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({
        action: 'query',
        prop: 'pageviews',
        pvipdays: String(PAGEVIEW_DAYS),
        titles: part.join('|'),
        format: 'json',
        formatversion: '2',
        maxlag: '5',
        ...cont,
      })}`;
      const json = await getJson<PageviewsResponse>(url);
      for (const n of json?.query?.normalized ?? []) normalized.set(n.from, n.to);
      for (const p of json?.query?.pages ?? []) if (p.pageviews) byTitle.set(p.title, sumDaily(p.pageviews));
      // Une requête à la fois, avec une pause : on reste sous les limites de Wikimedia.
      await new Promise((r) => setTimeout(r, pause));
      if (!json?.continue) break;
      cont = json.continue;
    }
    for (const t of part) out.set(t, byTitle.get(normalized.get(t) ?? t) ?? 0);
  }
  return out;
}

/** Vues de tous les candidats, toutes langues suivies confondues. */
export async function allViews(candidates: Candidate[], log: (msg: string) => void): Promise<void> {
  const totals = new Map<string, Record<string, number>>();
  for (const lang of PAGEVIEW_LANGUAGES) {
    const titles = candidates.flatMap((c) => (c.wikis[lang] ? [c.wikis[lang]!] : []));
    const views = await languageViews(lang, titles);
    for (const c of candidates) {
      const title = c.wikis[lang];
      if (!title) continue;
      const byLang = totals.get(c.qid) ?? {};
      byLang[lang] = views.get(title) ?? 0;
      totals.set(c.qid, byLang);
    }
    log(`  vues ${lang} : ${titles.length} articles`);
  }
  for (const c of candidates) {
    const byLanguage = totals.get(c.qid) ?? {};
    const last60Days = Object.values(byLanguage).reduce((s, v) => s + v, 0);
    c.views = { last60Days, annualEstimate: Math.round((last60Days * 365) / PAGEVIEW_DAYS), byLanguage };
  }
}
