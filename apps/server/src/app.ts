import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './auth/routes.js';
import type { ServerConfig } from './config.js';
import { createPgDb, createPgliteDb, type Db } from './db/db.js';
import { migrate } from './db/migrate.js';
import { registerDecks } from './decks/decks.js';
import { registerEconomy } from './economy/routes.js';
import { registerMatches } from './match/routes.js';
import { MatchService } from './match/service.js';

export interface App {
  app: FastifyInstance;
  db: Db;
  matches: MatchService;
}

/** Construit le serveur (base, migrations, routes) sans l'ouvrir sur le réseau : utilisable tel quel dans les tests. */
export async function buildApp(config: ServerConfig): Promise<App> {
  const db = config.databaseUrl ? createPgDb(config.databaseUrl) : await createPgliteDb(config.pgliteDir);
  await migrate(db);

  const app = Fastify({ logger: { level: config.logLevel }, trustProxy: config.trustProxy, bodyLimit: 64 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const deps = { db, config };
  const matches = new MatchService(deps);
  registerAuth(app, deps);
  registerDecks(app, deps);
  registerEconomy(app, deps);
  registerMatches(app, deps, matches);
  app.get('/api/health', async () => ({ ok: true }));

  app.addHook('onClose', async () => {
    await matches.close();
    await db.close();
  });
  return { app, db, matches };
}
