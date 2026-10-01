import { CATEGORIES, type CategoryId } from '@rabbithole/engine';
import { PER_SOURCE_LIMIT, SERIES_RULES, SOURCES } from './config.js';
import { fetchImages } from './commons.js';
import { mapLimit } from './http.js';
import { candidateViews } from './pageviews.js';
import { evaluatePolicy } from './policy.js';
import { scoreRun } from './score.js';
import type { Candidate, RunFile } from './types.js';
import { countryQidOf, extractSource, fetchEntities, isoCodes, parseEntity, victimsAmong } from './wikidata.js';

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
  const floor = SERIES_RULES[opts.seriesType].minSitelinks;
  const countryQid = opts.country ? await countryQidOf(opts.country) : null;
  if (opts.country && !countryQid) throw new Error(`Pays inconnu : ${opts.country}`);
  const sources = SOURCES.filter((s) => !opts.categories || opts.categories.includes(s.category));

  const found = new Map<string, { sitelinks: number; categories: CategoryId[]; sources: string[]; kind: Candidate['kind'] }>();
  for (const source of sources) {
    const min = Math.max(floor, source.minSitelinks ?? 0);
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

/** Étape 2a : vues Wikipédia (toutes langues suivies). */
export async function views(run: RunFile, log: Log, now = new Date()): Promise<void> {
  const todo = run.candidates.filter((c) => !c.views);
  let last = 0;
  let failed = 0;
  await mapLimit(
    todo,
    2,
    async (c) => {
      // Un échec n'arrête pas l'étape : le sujet sera repris au prochain « pipeline score ».
      try {
        c.views = await candidateViews(c, now);
      } catch (err) {
        failed++;
        log(`  vues indisponibles pour ${c.qid} : ${(err as Error).message}`);
      }
    },
    (done) => {
      if (done - last >= 50 || done === todo.length) {
        last = done;
        log(`  vues : ${done}/${todo.length}`);
      }
    },
  );
  if (failed) log(`  ${failed} sujet(s) sans vues : relance « pipeline score » pour les reprendre.`);
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

export { PER_SOURCE_LIMIT };
