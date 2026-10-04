import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { syncAdminRoles } from './auth/accounts.js';
import { createGuard, type Guard } from './auth/guard.js';
import { Catalog } from './catalog/catalog.js';
import { registerAdmin } from './admin/routes.js';
import { registerModeration } from './moderation/routes.js';
import { registerAuth } from './auth/routes.js';
import type { ServerConfig } from './config.js';
import { createPgDb, createPgliteDb, type Db } from './db/db.js';
import { migrate } from './db/migrate.js';
import { registerDecks } from './decks/decks.js';
import { registerEconomy } from './economy/routes.js';
import { registerMatches } from './match/routes.js';
import { registerSocial } from './social/routes.js';
import { registerPayments } from './payments/routes.js';
import { registerNotices } from './notices/routes.js';
import { registerRetention } from './retention/routes.js';
import { registerRanked } from './ranked/routes.js';
import { MatchService } from './match/service.js';

export interface App {
  app: FastifyInstance;
  db: Db;
  matches: MatchService;
  guard: Guard;
  catalog: Catalog;
}

/** Construit le serveur (base, migrations, routes) sans l'ouvrir sur le réseau : utilisable tel quel dans les tests. */
export async function buildApp(config: ServerConfig, services: Partial<Guard> = {}): Promise<App> {
  const db = config.databaseUrl ? createPgDb(config.databaseUrl) : await createPgliteDb(config.pgliteDir);
  await migrate(db);
  await syncAdminRoles(db, config.adminEmails);

  const app = Fastify({ logger: { level: config.logLevel }, trustProxy: config.trustProxy, bodyLimit: 64 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const guard = { ...createGuard(config.guard, (m) => app.log.info(m)), ...services };
  guard.disposable.start((err) => app.log.warn({ err }, 'liste d’e-mails jetables injoignable'));
  const catalog = await Catalog.open(db);
  const deps = { db, config, guard, catalog };
  const matches = new MatchService(deps);
  registerAuth(app, deps);
  registerDecks(app, deps);
  registerEconomy(app, deps);
  registerMatches(app, deps, matches);
  registerAdmin(app, deps);
  registerModeration(app, deps);
  registerSocial(app, deps);
  registerPayments(app, deps);
  registerNotices(app, deps);
  registerRetention(app, deps);
  registerRanked(app, deps);
  app.get('/api/health', async () => ({ ok: true }));

  app.addHook('onClose', async () => {
    guard.disposable.stop();
    await matches.close();
    await db.close();
  });
  return { app, db, matches, guard, catalog };
}
