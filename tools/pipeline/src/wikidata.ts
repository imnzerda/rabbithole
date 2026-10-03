import { LABEL_LANGUAGES, PAGEVIEW_LANGUAGES, type Source } from './config.js';
import { chunk, getJson } from './http.js';
import type { Candidate } from './types.js';

const SPARQL_URL = 'https://query.wikidata.org/sparql';
const API_URL = 'https://www.wikidata.org/w/api.php';

// ---------------------------------------------------------------------------
// SPARQL
// ---------------------------------------------------------------------------

interface Binding {
  [name: string]: { type: string; value: string } | undefined;
}

export async function sparql(query: string): Promise<Binding[]> {
  const json = await getJson<{ results: { bindings: Binding[] } }>(SPARQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json' },
    body: new URLSearchParams({ query }),
  });
  return json.results.bindings;
}

const qidOf = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);

/** Requête d'extraction d'une source : sujets classés par nombre de langues (sitelinks). */
export function buildSourceQuery(source: Source, minSitelinks: number, limit: number, countryQid: string | null): string {
  const country = countryQid ? `\n  ?item (wdt:P27|wdt:P17|wdt:P495) wd:${countryQid} .` : '';
  return `SELECT ?item ?sl WHERE {
  ${source.pattern}${country}
  ?item wikibase:sitelinks ?sl .
  FILTER(?sl >= ${minSitelinks})
} ORDER BY DESC(?sl) LIMIT ${limit}`;
}

export async function extractSource(source: Source, minSitelinks: number, limit: number, countryQid: string | null): Promise<{ qid: string; sitelinks: number }[]> {
  const rows = await sparql(buildSourceQuery(source, minSitelinks, limit, countryQid));
  return rows.map((b) => ({ qid: qidOf(b.item!.value), sitelinks: Number(b.sl!.value) }));
}

/** Code pays ISO 3166-1 alpha-2 → élément Wikidata (ex. FR → Q142). */
export async function countryQidOf(iso: string): Promise<string | null> {
  const rows = await sparql(`SELECT ?c WHERE { ?c wdt:P297 "${iso.toUpperCase().replace(/[^A-Z]/g, '')}" . }`);
  return rows[0]?.c ? qidOf(rows[0].c.value) : null;
}

/** Sujets cités comme victimes (P8032) d'un événement : exclus ou revus (section 5). */
export async function victimsAmong(qids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunk(qids, 200)) {
    const rows = await sparql(`SELECT DISTINCT ?item WHERE { VALUES ?item { ${part.map((q) => `wd:${q}`).join(' ')} } ?event wdt:P8032 ?item . }`);
    for (const r of rows) out.add(qidOf(r.item!.value));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entités (API wbgetentities, par lots de 50)
// ---------------------------------------------------------------------------

interface Snak {
  mainsnak: { snaktype: string; datavalue?: { value: unknown } };
  rank?: string;
}
export interface WdEntity {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Snak[]>;
  sitelinks?: Record<string, { title: string }>;
}

export async function fetchEntities(qids: string[], props = 'labels|descriptions|claims|sitelinks'): Promise<Map<string, WdEntity>> {
  const out = new Map<string, WdEntity>();
  for (const part of chunk(qids, 50)) {
    const url = `${API_URL}?${new URLSearchParams({
      action: 'wbgetentities',
      ids: part.join('|'),
      props,
      languages: LABEL_LANGUAGES.join('|'),
      sitefilter: PAGEVIEW_LANGUAGES.map((l) => `${l}wiki`).join('|'),
      format: 'json',
    })}`;
    const json = await getJson<{ entities: Record<string, WdEntity> }>(url);
    for (const [id, e] of Object.entries(json.entities ?? {})) out.set(id, e);
  }
  return out;
}

const values = (e: WdEntity, prop: string): unknown[] =>
  (e.claims?.[prop] ?? []).filter((s) => s.rank !== 'deprecated' && s.mainsnak.snaktype === 'value').map((s) => s.mainsnak.datavalue?.value);

const ids = (e: WdEntity, prop: string): string[] => values(e, prop).flatMap((v) => ((v as { id?: string })?.id ? [(v as { id: string }).id] : []));

/** Date Wikidata (`+1958-08-29T00:00:00Z`) → `1958-08-29` (`-0069-…` pour avant notre ère). */
export function wdDate(value: unknown): string | null {
  const time = (value as { time?: string })?.time;
  if (!time) return null;
  const m = /^([+-])(\d+)-(\d{2})-(\d{2})/.exec(time);
  if (!m) return null;
  const year = m[2]!.replace(/^0+(?=\d{4})/, '');
  return `${m[1] === '-' ? '-' : ''}${year}-${m[3] === '00' ? '01' : m[3]}-${m[4] === '00' ? '01' : m[4]}`;
}

const firstDate = (e: WdEntity, ...props: string[]): string | null => {
  for (const p of props) {
    const d = values(e, p).map(wdDate).filter((x): x is string => x !== null).sort()[0];
    if (d) return d;
  }
  return null;
};

/** Entité Wikidata → candidat (sans pays ISO ni vues : étapes suivantes). */
export function parseEntity(e: WdEntity, sitelinks: number): Omit<Candidate, 'kind' | 'categories' | 'sources' | 'countries' | 'listedAsVictim'> & { countryQids: string[] } {
  const labels: Record<string, string> = {};
  for (const [lang, l] of Object.entries(e.labels ?? {})) labels[lang] = l.value;
  // Libellé multilingue : vaut pour les langues sans libellé propre.
  if (labels.mul) for (const lang of LABEL_LANGUAGES) if (lang !== 'mul' && !labels[lang]) labels[lang] = labels.mul;
  const descriptions: Record<string, string> = {};
  for (const [lang, d] of Object.entries(e.descriptions ?? {})) descriptions[lang] = d.value;
  const wikis: Record<string, string> = {};
  for (const [site, s] of Object.entries(e.sitelinks ?? {})) wikis[site.replace(/wiki$/, '')] = s.title;
  const image = values(e, 'P18').find((v): v is string => typeof v === 'string') ?? null;
  return {
    qid: e.id,
    labels,
    descriptions,
    countryQids: [...new Set([...ids(e, 'P27'), ...ids(e, 'P17'), ...ids(e, 'P495')])],
    instanceOf: ids(e, 'P31'),
    occupations: ids(e, 'P106'),
    birth: firstDate(e, 'P569'),
    death: firstDate(e, 'P570'),
    start: firstDate(e, 'P2031', 'P580', 'P571', 'P585', 'P577'),
    end: firstDate(e, 'P2032', 'P582', 'P576'),
    sitelinks,
    wikis,
    image,
    convictedOf: ids(e, 'P1399'),
    mannerOfDeath: ids(e, 'P1196'),
    causeOfDeath: ids(e, 'P509'),
    memberOf: ids(e, 'P463'),
  };
}

/** Pays Wikidata → code ISO alpha-2 (P297), avec cache. */
const isoCache = new Map<string, string | null>();
export async function isoCodes(countryQids: string[]): Promise<Map<string, string | null>> {
  const missing = countryQids.filter((q) => !isoCache.has(q));
  if (missing.length) {
    const entities = await fetchEntities(missing, 'claims');
    for (const q of missing) {
      const e = entities.get(q);
      const iso = e ? values(e, 'P297').find((v): v is string => typeof v === 'string') : undefined;
      isoCache.set(q, iso ?? null);
    }
  }
  return new Map(countryQids.map((q) => [q, isoCache.get(q) ?? null]));
}

/** Nombre de langues (sitelinks) de sujets donnés. */
export async function sitelinkCounts(qids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const part of chunk(qids, 200)) {
    const rows = await sparql(`SELECT ?item ?sl WHERE { VALUES ?item { ${part.map((q) => `wd:${q}`).join(' ')} } ?item wikibase:sitelinks ?sl . }`);
    for (const r of rows) out.set(qidOf(r.item!.value), Number(r.sl!.value));
  }
  return out;
}
