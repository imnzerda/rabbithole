import type { ServerConfig } from './config.js';
import type { Db } from './db/db.js';

/** Dépendances partagées par les routes (injectées : faciles à remplacer dans les tests). */
export interface AppDeps {
  db: Db;
  config: ServerConfig;
}
