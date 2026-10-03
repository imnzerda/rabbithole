import { CATEGORIES, type CategoryId } from '@rabbithole/engine';
import { loadRun, saveCsv, saveRun } from './store.js';
import { addSubjects, extract, images, mergeRuns, PER_SOURCE_LIMIT, policy, score, summary, views } from './steps.js';
import type { Candidate, RunFile } from './types.js';

/**
 * Pipeline de création de cartes (section 11).
 *
 *   pnpm pipeline extract  --series base_01 [--type base|world|country] [--country FR] [--categories musique,sport] [--limit 150]
 *                                          (fusionne avec l'extraction précédente : --categories ne touche qu'à ces catégories)
 *   pnpm pipeline score    --series base_01 [--refresh]   vues Wikipédia + score de notoriété
 *   pnpm pipeline policy   --series base_01     politique de contenu (exclus / à revoir)
 *   pnpm pipeline images   --series base_01     images Commons, licences vérifiées
 *   pnpm pipeline export   --series base_01     liste courte en CSV
 *   pnpm pipeline validate --series base_01     bilan de la série
 *   pnpm pipeline all      --series base_01 …   toutes les étapes
 *   pnpm pipeline add      --series base_01 --category mysteres --qids Q43708,Q177397 [--kind place]
 *                          ajout manuel de sujets (puis vues, score, politique, images)
 *
 * Les résultats sont dans `tools/pipeline/out/<série>.json`, importés ensuite dans l'outil d'admin.
 */

const log = (msg: string) => process.stderr.write(`${msg}\n`);

function parseArgs(argv: string[]): { command: string; opts: Record<string, string> } {
  const [command = 'help', ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) continue;
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      opts[a.slice(2)] = next;
      i++;
    } else opts[a.slice(2)] = 'true';
  }
  return { command, opts };
}

function seriesType(v: string | undefined, country: string | null): RunFile['seriesType'] {
  const t = v ?? (country ? 'country' : 'base');
  if (t !== 'base' && t !== 'world' && t !== 'country') throw new Error(`--type inconnu : ${t}`);
  return t;
}

function categories(v: string | undefined): CategoryId[] | null {
  if (!v || v === 'all') return null;
  const list = v.split(',').map((x) => x.trim());
  for (const c of list) if (!(CATEGORIES as readonly string[]).includes(c)) throw new Error(`Catégorie inconnue : ${c} (${CATEGORIES.join(', ')})`);
  return list as CategoryId[];
}

async function main(): Promise<void> {
  const { command, opts } = parseArgs(process.argv.slice(2));
  const country = opts.country?.toUpperCase() ?? null;
  const series = opts.series ?? (country ? `${country.toLowerCase()}_01` : 'base_01');

  const runExtract = async () => {
    log(`Extraction Wikidata pour ${series}…`);
    const cats = categories(opts.categories);
    const fresh = await extract({ series, seriesType: seriesType(opts.type, country), country, categories: cats, limit: Number(opts.limit ?? PER_SOURCE_LIMIT) }, log);
    // Les candidats déjà connus (autres catégories, ajouts manuels, vues, images) ne sont pas perdus.
    let previous: RunFile | null = null;
    try {
      previous = loadRun(series);
    } catch {
      previous = null;
    }
    const run = mergeRuns(previous, fresh, cats !== null);
    log(`→ ${saveRun(run, 'extract')} (${run.candidates.length} candidats)`);
    return run;
  };
  const runScore = async (run: RunFile) => {
    // --refresh : recalcule les vues de tous les sujets.
    if (opts.refresh) for (const c of run.candidates) delete c.views;
    log('Vues Wikipédia (60 derniers jours)…');
    await views(run, log);
    score(run);
    log(`→ ${saveRun(run, 'score')}`);
  };
  const runPolicy = (run: RunFile) => {
    policy(run);
    log(`→ ${saveRun(run, 'policy')}`);
  };
  const runImages = async (run: RunFile) => {
    log('Images Wikimedia Commons…');
    await images(run, log);
    log(`→ ${saveRun(run, 'images')}`);
  };

  switch (command) {
    case 'extract':
      await runExtract();
      break;
    case 'score':
      await runScore(loadRun(series));
      break;
    case 'policy':
      runPolicy(loadRun(series));
      break;
    case 'images':
      await runImages(loadRun(series));
      break;
    case 'export':
      log(`→ ${saveCsv(loadRun(series))}`);
      break;
    case 'validate':
      for (const line of summary(loadRun(series))) console.log(line);
      break;
    case 'add': {
      const category = categories(opts.category)?.[0];
      const qids = (opts.qids ?? '').split(',').map((q) => q.trim().toUpperCase()).filter((q) => /^Q\d+$/.test(q));
      if (!category || !qids.length) throw new Error('--category et --qids sont obligatoires');
      const kind = (opts.kind ?? 'concept') as Candidate['kind'];
      const run = loadRun(series);
      log(`Ajout de ${qids.length} sujet(s) en ${category}…`);
      await addSubjects(run, qids, category, kind, log);
      await runScore(run);
      runPolicy(run);
      await runImages(run);
      log(`→ ${saveCsv(run)}`);
      break;
    }
    case 'all': {
      const run = await runExtract();
      await runScore(run);
      runPolicy(run);
      await runImages(run);
      log(`→ ${saveCsv(run)}`);
      for (const line of summary(run)) console.log(line);
      break;
    }
    default:
      console.log('Commandes : extract, score, policy, images, export, validate, all (voir src/cli.ts).');
  }
}

main().catch((err: unknown) => {
  log(`Erreur : ${(err as Error).message}`);
  process.exitCode = 1;
});
