import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CardDef } from '@rabbithole/engine';
import { createSeries, importCandidates, importDrafts, saveCard, setCardStatus, setSeriesStatus, workingContext, type PipelineRun } from '../src/admin/admin.js';
import { loadConfig } from '../src/config.js';
import { createPgDb, createPgliteDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { importReferenceDecks, type DeckImport } from '../src/decks/reference.js';

/**
 * Import d'une série en ligne de commande, avec les mêmes fonctions que l'outil d'admin :
 * candidats du pipeline, lots de brouillons, decks de référence, et publication si demandée.
 * Le serveur doit être arrêté (la base PGlite de développement ne s'ouvre qu'une fois).
 *
 *   pnpm --filter @rabbithole/server content:import -- --series base_01 \
 *     --candidates ../../tools/pipeline/out/base_01.json \
 *     --drafts ../../tools/pipeline/drafts/base_01.json,../../tools/pipeline/drafts/base_01_lot2.json \
 *     --decks ../../tools/pipeline/decks/base_01.json --publish [--sync]
 *
 * --sync : les cartes déjà présentes reprennent la définition du lot (stats, effets, textes).
 */

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = 'true';
  }
  return out;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
const log = (msg: string) => process.stdout.write(`${msg}\n`);

async function main(): Promise<void> {
  const opts = args(process.argv.slice(2));
  const series = opts.series;
  if (!series) throw new Error('--series est obligatoire');
  const config = loadConfig();
  const db = config.databaseUrl ? createPgDb(config.databaseUrl) : await createPgliteDb(config.pgliteDir);
  await migrate(db);
  const note = async (action: string, payload: unknown) =>
    db.query('INSERT INTO admin_audit (admin_id, action, target, payload) VALUES (NULL, $1, $2, $3)', [action, series, JSON.stringify(payload)]);

  try {
    if (opts.candidates) {
      const r = await importCandidates(db, readJson<PipelineRun>(opts.candidates));
      log(`Candidats : ${r.imported} nouveaux, ${r.updated} mis à jour.`);
      await note('cli.candidates.import', r);
    }
    for (const path of (opts.drafts ?? '').split(',').filter(Boolean)) {
      const lot = readJson<{ series: string; seriesInfo?: { type: string; country: string | null; name: Record<string, string> }; cards: CardDef[] }>(path);
      const [exists] = await db.query('SELECT 1 FROM series WHERE id = $1', [series]);
      if (!exists) {
        if (!lot.seriesInfo) throw new Error(`Série ${series} inconnue et pas de seriesInfo dans ${path}`);
        await createSeries(db, { id: series, ...lot.seriesInfo });
        log(`Série ${series} créée.`);
      }
      const r = await importDrafts(db, series, lot.cards);
      log(`${path} : ${r.created.length} brouillon(s) créé(s)${r.skipped.length ? `, ignorées : ${r.skipped.map((s) => `${s.id} (${s.reason})`).join(', ')}` : ''}.`);
      await note('cli.cards.import_drafts', { file: path, created: r.created.length, skipped: r.skipped.length });
      if (opts.sync) {
        const ctx = await workingContext(db);
        let synced = 0;
        for (const s of r.skipped.filter((x) => x.reason === 'exists')) {
          const def = lot.cards.find((c) => c.id === s.id)!;
          const [row] = await db.query<{ def: CardDef }>('SELECT def FROM cards WHERE id = $1', [s.id]);
          // L'image reste celle de la base (crédits, retrait éventuel).
          const next = { ...def, series, image: row?.def.image ?? def.image };
          if (JSON.stringify(row?.def) === JSON.stringify(next)) continue;
          await saveCard(db, s.id, next, ctx);
          synced++;
          log(`  synchronisée : ${s.id}`);
        }
        await note('cli.cards.sync', { file: path, synced });
      }
    }
    if (opts.decks) {
      const file = readJson<{ decks: DeckImport[] }>(opts.decks);
      const r = await importReferenceDecks(db, series, file.decks, await workingContext(db));
      log(`Decks de référence : ${r.imported.length} importé(s)${r.invalid.length ? `, invalides : ${r.invalid.map((d) => `${d.id} (${d.errors.join(' ; ')})`).join(', ')}` : ''}.`);
      await note('cli.decks.import', { imported: r.imported.length, invalid: r.invalid.length });
    }
    if (opts.publish) {
      const ctx = await workingContext(db);
      const rows = await db.query<{ id: string; status: string }>("SELECT id, status FROM cards WHERE series_id = $1 AND status IN ('draft', 'review')", [series]);
      const failed: string[] = [];
      for (const row of rows) {
        try {
          if (row.status === 'draft') await setCardStatus(db, row.id, 'review', ctx);
          await setCardStatus(db, row.id, 'published', ctx);
        } catch (err) {
          failed.push(`${row.id} (${(err as { details?: unknown }).details ?? (err as Error).message})`);
        }
      }
      await setSeriesStatus(db, series, 'published');
      log(`Publication : ${rows.length - failed.length} carte(s) publiée(s), série ${series} publiée.${failed.length ? ` Échecs : ${failed.join(', ')}` : ''}`);
      await note('cli.series.publish', { published: rows.length - failed.length, failed });
    }
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Erreur : ${(err as Error).message}\n`);
  process.exitCode = 1;
});
