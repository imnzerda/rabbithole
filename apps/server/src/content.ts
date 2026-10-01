import { createHash } from 'node:crypto';
import { LEADER_CARDS, COLLECTIBLE_CARDS, PROTOTYPE_CARDS, PROTOTYPE_DECKS, prototypeContext } from '@rabbithole/content';
import type { MatchContext } from '@rabbithole/engine';
import type { Db } from './db/db.js';

/** Catalogue et règles qui font foi côté serveur. */
export const ctx: MatchContext = prototypeContext();

/**
 * Version du contenu (cartes + règles) : enregistrée avec chaque partie,
 * car un replay n'est exact qu'avec les mêmes définitions.
 */
export const CONTENT_VERSION = `prototype@${createHash('sha256')
  .update(JSON.stringify({ cards: PROTOTYPE_CARDS, rules: ctx.rules }))
  .digest('hex')
  .slice(0, 12)}`;

/**
 * Kit complet (tous les Leaders, chaque carte au maximum jouable, les 5 decks préconstruits).
 * Réservé aux tests automatisés : les joueurs construisent leur collection en ouvrant des boosters.
 */
export async function grantTestKit(db: Db, userId: string): Promise<void> {
  for (const c of LEADER_CARDS) {
    await db.query(
      `INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, 1)
       ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = GREATEST(collections.quantity, 1)`,
      [userId, c.id],
    );
  }
  for (const c of COLLECTIBLE_CARDS) {
    await db.query(
      `INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = GREATEST(collections.quantity, $3)`,
      [userId, c.id, ctx.rules.maxCopiesPerCard],
    );
  }
  for (const d of PROTOTYPE_DECKS) {
    await db.query('INSERT INTO decks (user_id, name, leader_id, card_ids) VALUES ($1, $2, $3, $4)', [userId, d.name.fr ?? d.id, d.leader, d.cards]);
  }
}

export { PROTOTYPE_DECKS };
