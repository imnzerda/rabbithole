import type { Guard } from './auth/guard.js';
import type { Catalog } from './catalog/catalog.js';
import type { ServerConfig } from './config.js';
import type { Db } from './db/db.js';

/** Dépendances partagées par les routes (injectées : faciles à remplacer dans les tests). */
export interface AppDeps {
  db: Db;
  config: ServerConfig;
  /** Protections de l'inscription : captcha, SMS, réputation d'IP, e-mails jetables, débit. */
  guard: Guard;
  /** Catalogue de cartes publié (fait foi pour les parties, les boosters et les decks). */
  catalog: Catalog;
}
