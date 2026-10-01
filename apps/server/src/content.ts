import { PROTOTYPE_DECKS } from '@rabbithole/content';
import type { CatalogSnapshot } from './catalog/catalog.js';
import type { Db } from './db/db.js';

/**
 * Kit complet (tous les Leaders, chaque carte au maximum jouable, les 5 decks préconstruits).
 * Réservé aux tests automatisés : les joueurs construisent leur collection en ouvrant des boosters.
 */
export async function grantTestKit(db: Db, userId: string, catalog: CatalogSnapshot): Promise<void> {
  for (const c of catalog.leaders) {
    await db.query(
      `INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, 1)
       ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = GREATEST(collections.quantity, 1)`,
      [userId, c.id],
    );
  }
  for (const c of catalog.collectibles) {
    await db.query(
      `INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = GREATEST(collections.quantity, $3)`,
      [userId, c.id, catalog.ctx.rules.maxCopiesPerCard],
    );
  }
  for (const d of PROTOTYPE_DECKS) {
    await db.query('INSERT INTO decks (user_id, name, leader_id, card_ids) VALUES ($1, $2, $3, $4)', [userId, d.name.fr ?? d.id, d.leader, d.cards]);
  }
}

export { PROTOTYPE_DECKS };
