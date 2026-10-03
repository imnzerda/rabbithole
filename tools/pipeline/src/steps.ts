import { CATEGORIES, type CategoryId } from '@rabbithole/engine';
import { notorietyRule, PER_SOURCE_LIMIT, SOURCES } from './config.js';
import { fetchImages } from './commons.js';
import { mapLimit } from './http.js';
import { allViews } from './pageviews.js';
import { evaluatePolicy } from './policy.js';
import { scoreRun } from './score.js';
import type { Candidate, RunFile } from './types.js';
import { countryQidOf, extractSource, fetchEntities, isoCodes, parseEntity, sitelinkCounts, victimsAmong } from './wikidata.js';

export type Log = (msg: string) => void;

export interface ExtractOptions {
  series: string;
  seriesType: RunFile['seriesType'];
  country: string | null;
  categories: CategoryId[] | null;
  limit: number;
}

/** Étape 1 : extraction Wikidata, source par source, puis détails des sujets. */
export async function extract(opts: ExtractOptions, log: Log): Promise<RunFile> {
  const countryQid = opts.country ? await countryQidOf(opts.country) : null;
  if (opts.country && !countryQid) throw new Error(`Pays inconnu : ${opts.country}`);
  const sources = SOURCES.filter((s) => !opts.categories || opts.categories.includes(s.category));

  const found = new Map<string, { sitelinks: number; categories: CategoryId[]; sources: string[]; kind: Candidate['kind'] }>();
  for (const source of sources) {
    const min = Math.max(notorietyRule(opts.seriesType, source.category).minSitelinks, source.minSitelinks ?? 0);
    try {
      const rows = await extractSource(source, min, opts.limit, countryQid);
      log(`  ${source.id.padEnd(18)} ${String(rows.length).padStart(4)} sujets (≥ ${min} langues)`);
      for (const r of rows) {
        const hit = found.get(r.qid);
        if (hit) {
          if (!hit.categories.includes(source.category)) hit.categories.push(source.category);
          hit.sources.push(source.id);
        } else found.set(r.qid, { sitelinks: r.sitelinks, categories: [source.category], sources: [source.id], kind: source.kind });
      }
    } catch (err) {
      log(`  ${source.id.padEnd(18)} échec : ${(err as Error).message}`);
    }
  }

  const qids = [...found.keys()];
  log(`Détails de ${qids.length} sujets…`);
  const entities = await fetchEntities(qids);
  const victims = await victimsAmong(qids);
  const parsed = qids.flatMap((qid) => {
    const e = entities.get(qid);
    return e ? [{ qid, p: parseEntity(e, found.get(qid)!.sitelinks) }] : [];
  });
  const iso = await isoCodes([...new Set(parsed.flatMap((x) => x.p.countryQids))]);

  const candidates: Candidate[] = parsed.map(({ qid, p }) => {
    const { countryQids, ...rest } = p;
    const meta = found.get(qid)!;
    return {
      ...rest,
      kind: rest.instanceOf.includes('Q5') ? 'person' : meta.kind,
      categories: meta.categories.sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)),
      sources: meta.sources,
      countries: [...new Set(countryQids.map((q) => iso.get(q)).filter((x): x is string => !!x))],
      listedAsVictim: victims.has(qid),
    };
  });
  const now = new Date().toISOString();
  return { series: opts.series, seriesType: opts.seriesType, country: opts.country, createdAt: now, updatedAt: now, steps: [], candidates };
}

/**
 * Fusionne une nouvelle extraction avec la précédente :
 * - extraction partielle (`--categories`) : les autres candidats sont gardés ;
 * - extraction complète : seuls les sujets ajoutés à la main (`pipeline add`) sont gardés en plus.
 * Un sujet déjà connu reprend ses vues et la vérification de son image (si c'est la même), pour
 * éviter de retélécharger ; ses catégories sont réunies.
 */
export function mergeRuns(previous: RunFile | null, fresh: RunFile, partial: boolean): RunFile {
  if (!previous) return fresh;
  const before = new Map(previous.candidates.map((c) => [c.qid, c]));
  const freshIds = new Set(fresh.candidates.map((c) => c.qid));
  for (const c of fresh.candidates) {
    const old = before.get(c.qid);
    if (!old) continue;
    if (old.views) c.views = old.views;
    if (old.image === c.image && old.imageInfo !== undefined) c.imageInfo = old.imageInfo;
    c.categories = [...new Set([...c.categories, ...old.categories])].sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b));
    c.sources = [...new Set([...c.sources, ...old.sources])];
  }
  const kept = previous.candidates.filter((c) => !freshIds.has(c.qid) && (partial || c.sources.includes('manuel')));
  return { ...fresh, createdAt: previous.createdAt, steps: previous.steps, candidates: [...fresh.candidates, ...kept] };
}

/** Étape 2a : vues Wikipédia des 60 derniers jours (toutes langues suivies, par lots de 50). */
export async function views(run: RunFile, log: Log): Promise<void> {
  const todo = run.candidates.filter((c) => !c.views);
  log(`  ${todo.length} sujets sans vues`);
  await allViews(todo, log);
}

/** Étape 2b : score de notoriété. */
export function score(run: RunFile, now = new Date()): void {
  scoreRun(run, now);
}

/** Étape 3 : politique de contenu. */
export function policy(run: RunFile, now = new Date()): void {
  for (const c of run.candidates) {
    const r = evaluatePolicy(c, now);
    c.policy = { status: r.status, reasons: r.reasons };
    c.flags = r.flags;
  }
}

/** Étape 8 : images Commons, licence vérifiée (seulement pour les candidats non exclus). */
export async function images(run: RunFile, log: Log): Promise<void> {
  const todo = run.candidates.filter((c) => c.image && c.imageInfo === undefined && c.policy?.status !== 'excluded');
  const infos = await fetchImages(todo.map((c) => c.image!));
  for (const c of todo) c.imageInfo = infos.get(c.image!) ?? null;
  for (const c of run.candidates) if (!c.image) c.imageInfo = null;
  const accepted = todo.filter((c) => c.imageInfo?.accepted).length;
  log(`  images : ${accepted}/${todo.length} sous licence libre acceptée`);
}

/** Bilan d'une série : de quoi décider de la curation. */
export function summary(run: RunFile): string[] {
  const c = run.candidates;
  const count = (f: (x: Candidate) => boolean) => c.filter(f).length;
  const lines = [
    `Série ${run.series} (${run.seriesType}${run.country ? `, ${run.country}` : ''}) : ${c.length} candidats — étapes : ${run.steps.join(', ') || 'aucune'}`,
    `  politique : ${count((x) => x.policy?.status === 'ok')} ok, ${count((x) => x.policy?.status === 'needs_review')} à revoir, ${count((x) => x.policy?.status === 'excluded')} exclus`,
    `  notoriété : ${count((x) => !!x.score?.meetsThreshold)} au-dessus du seuil, ${count((x) => !!x.score?.iconic)} iconiques`,
    `  images : ${count((x) => !!x.imageInfo?.accepted)} libres, ${count((x) => x.imageInfo === null)} sans image (carte typographique)`,
    `  sensibles : ${count((x) => !!x.flags?.sensitive)}, adultes : ${count((x) => !!x.flags?.adult)}`,
  ];
  const usable = c.filter((x) => x.policy?.status !== 'excluded' && x.score?.meetsThreshold);
  const byCat = new Map<string, number>();
  for (const x of usable) for (const cat of x.categories) byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
  lines.push(`  utilisables par catégorie : ${[...byCat].map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`);
  return lines;
}

/**
 * Ajout manuel de sujets par leur identifiant Wikidata (curation : sujets hors des sources,
 * comme un mème ou un lieu). Ils passent ensuite par les mêmes étapes que les autres.
 * Un sujet déjà présent reçoit la catégorie en plus.
 */
export async function addSubjects(run: RunFile, qids: string[], category: CategoryId, kind: Candidate['kind'], log: Log): Promise<string[]> {
  const fresh = qids.filter((q) => !run.candidates.some((c) => c.qid === q));
  for (const c of run.candidates) if (qids.includes(c.qid) && !c.categories.includes(category)) c.categories.push(category);
  if (!fresh.length) return [];
  const [entities, counts, victims] = await Promise.all([fetchEntities(fresh), sitelinkCounts(fresh), victimsAmong(fresh)]);
  const parsed = fresh.flatMap((qid) => {
    const e = entities.get(qid);
    return e ? [{ qid, p: parseEntity(e, counts.get(qid) ?? 0) }] : [];
  });
  const iso = await isoCodes([...new Set(parsed.flatMap((x) => x.p.countryQids))]);
  for (const { qid, p } of parsed) {
    const { countryQids, ...rest } = p;
    run.candidates.push({
      ...rest,
      kind: rest.instanceOf.includes('Q5') ? 'person' : kind,
      categories: [category],
      sources: ['manuel'],
      countries: [...new Set(countryQids.map((q) => iso.get(q)).filter((x): x is string => !!x))],
      listedAsVictim: victims.has(qid),
    });
    log(`  + ${rest.labels.fr ?? rest.labels.en ?? qid} (${qid}, ${counts.get(qid) ?? 0} langues)`);
  }
  return parsed.map((x) => x.qid);
}

export { PER_SOURCE_LIMIT };
