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
import { registerTournaments } from './tournament/routes.js';
import { TournamentScheduler } from './tournament/tournament.js';
import { registerRanked } from './ranked/routes.js';
import { registerTrending } from './trending/routes.js';
import { TrendingScheduler, wikimediaSource, type ViewsSource } from './trending/trending.js';
import { MatchService } from './match/service.js';

export interface App {
  app: FastifyInstance;
  db: Db;
  matches: MatchService;
  guard: Guard;
  catalog: Catalog;
}

/** Construit le serveur (base, migrations, routes) sans l'ouvrir sur le réseau : utilisable tel quel dans les tests. */
export async function buildApp(config: ServerConfig, services: Partial<Guard> & { trendingSource?: ViewsSource } = {}): Promise<App> {
  const db = config.databaseUrl ? createPgDb(config.databaseUrl) : await createPgliteDb(config.pgliteDir);
  await migrate(db);
  await syncAdminRoles(db, config.adminEmails);

  const app = Fastify({ logger: { level: config.logLevel }, trustProxy: config.trustProxy, bodyLimit: 64 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const { trendingSource, ...guardServices } = services;
  const guard = { ...createGuard(config.guard, (m) => app.log.info(m)), ...guardServices };
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
  registerTrending(app, deps);
  registerTournaments(app, deps);
  // Tendance du jour : calcul quotidien, puis publication après la fenêtre de vérification (section 8).
  const trending = config.trending.enabled
    ? new TrendingScheduler(db, config.trending, () => catalog.current, trendingSource ?? wikimediaSource, (msg, err) => (err ? app.log.warn({ err }, msg) : app.log.info(msg)))
    : null;
  trending?.start();
  // Tournoi hebdomadaire : début à l'heure prévue, échéances des tours.
  const tournaments = config.tournament.enabled
    ? new TournamentScheduler(db, config.tournament, () => catalog.current, (msg, err) => (err ? app.log.warn({ err }, msg) : app.log.info(msg)))
    : null;
  tournaments?.start();
  app.get('/api/health', async () => ({ ok: true }));

  app.addHook('onClose', async () => {
    guard.disposable.stop();
    trending?.stop();
    tournaments?.stop();
    await matches.close();
    await db.close();
  });
  return { app, db, matches, guard, catalog };
}
