import { removeSeries } from '../src/admin/admin.js';
import { loadConfig } from '../src/config.js';
import { createPgDb, createPgliteDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';

/**
 * Suppression définitive de séries (serveur arrêté) : cartes, images, decks de référence ; nettoyage des
 * collections, decks de joueurs et aperçus de boosters qui les utilisent. Irréversible : pas de bouton dans l'admin.
 *
 *   pnpm --filter @rabbithole/server content:remove-series -- --series prototype,prototype_tokens
 */
async function main(): Promise<void> {
  const i = process.argv.indexOf('--series');
  const ids = (i >= 0 ? (process.argv[i + 1] ?? '') : '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error('--series est obligatoire (identifiants séparés par des virgules)');
  const config = loadConfig();
  const db = config.databaseUrl ? createPgDb(config.databaseUrl) : await createPgliteDb(config.pgliteDir);
  await migrate(db);
  try {
    for (const id of ids) {
      const r = await removeSeries(db, id);
      process.stdout.write(`Série ${id} supprimée : ${r.cards} carte(s), ${r.collections} entrée(s) de collection, ${r.decks} deck(s) de joueurs, ${r.previews} aperçu(s) de booster.\n`);
      await db.query("INSERT INTO admin_audit (admin_id, action, target, payload) VALUES (NULL, 'cli.series.remove', $1, $2)", [id, JSON.stringify(r)]);
    }
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Erreur : ${(err as Error).message}\n`);
  process.exitCode = 1;
});
