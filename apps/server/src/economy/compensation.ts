import type { CardDef, Rarity } from '@rabbithole/engine';
import type { Db } from '../db/db.js';

/**
 * Retrait d'une carte du jeu (section 5) : la carte quitte les collections, les decks et les échanges en
 * attente, et chaque joueur qui la possédait reçoit des pièces, au prix de fabrication par exemplaire,
 * avec une notification. Tout se fait dans la même transaction que le changement de statut.
 */
export async function retireCard(db: Db, cardId: string, craft: Record<Rarity, number>): Promise<{ players: number; coins: number }> {
  return db.transaction(async (tx) => {
    const [card] = await tx.query<{ def: CardDef; status: string }>('SELECT def, status FROM cards WHERE id = $1', [cardId]);
    if (!card) return { players: 0, coins: 0 };
    await tx.query("UPDATE cards SET status = 'retired', updated_at = now() WHERE id = $1", [cardId]);

    const per = craft[card.def.rarity] ?? 0;
    const owners = await tx.query<{ user_id: string; quantity: number }>('SELECT user_id, quantity FROM collections WHERE card_id = $1 AND quantity > 0', [cardId]);
    let total = 0;
    for (const o of owners) {
      const coins = per * o.quantity;
      total += coins;
      await tx.query('UPDATE wallets SET coins = coins + $2 WHERE user_id = $1', [o.user_id, coins]);
      await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'card_retired', $3)", [o.user_id, coins, cardId]);
      await tx.query("INSERT INTO notices (user_id, kind, payload) VALUES ($1, 'card_retired', $2)", [
        o.user_id,
        JSON.stringify({ cardId, name: card.def.name, rarity: card.def.rarity, quantity: o.quantity, coins }),
      ]);
    }
    await tx.query('DELETE FROM collections WHERE card_id = $1', [cardId]);
    // Les decks perdent la carte ; un Leader retiré reste en tête du deck, qui demande alors un autre Leader.
    await tx.query('UPDATE decks SET card_ids = array_remove(card_ids, $1), updated_at = now() WHERE $1 = ANY(card_ids)', [cardId]);
    await tx.query(
      `UPDATE trades SET status = 'cancelled', resolved_at = now()
       WHERE status = 'pending' AND id IN (SELECT trade_id FROM trade_items WHERE card_id = $1)`,
      [cardId],
    );
    return { players: owners.length, coins: total };
  });
}
