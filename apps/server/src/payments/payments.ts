import type { PassConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { EconomyError } from '../economy/economy.js';
import type { OfferDto as Offer, PurchaseDto as Purchase } from '@rabbithole/shared';
import { assertPassPurchasable, recomputeTrack, setTrack } from '../retention/pass.js';
import type { PaymentEvent, PaymentProvider } from './provider.js';

/**
 * Boutique en argent réel (sections 6.6 et 14) : packs de gemmes et pistes du pass, au prix du pays du joueur. Le passage
 * en caisse crée une transaction « pending » ; seul un webhook vérifié du prestataire la complète et
 * crédite les gemmes, une seule fois (événements et identifiants de transaction uniques).
 */

/** Offres actives d'un type (`gems`, `pass`), au prix du pays (sinon le prix par défaut « * »). */
export async function listOffers(db: Db, country: string, type: string | null = 'gems'): Promise<Offer[]> {
  const rows = await db.query<{ id: string; name: Record<string, string>; contents: { gems?: number }; currency: string; amount: number }>(
    `SELECT p.id, p.name, p.contents, pt.currency, pt.amount
     FROM products p
     JOIN LATERAL (
       SELECT currency, amount FROM price_tiers WHERE product_id = p.id AND country IN ($1, '*')
       ORDER BY (country = '*') LIMIT 1
     ) pt ON true
     WHERE p.active AND ($2::text IS NULL OR p.type = $2) ORDER BY p.sort`,
    [country, type],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, gems: r.contents.gems ?? 0, amount: r.amount, currency: r.currency }));
}

/** Dépenses du mois en cours (achats crédités et non remboursés), dans une devise. */
export async function monthSpent(db: Db, userId: string, currency: string): Promise<number> {
  const [row] = await db.query<{ total: number }>(
    `SELECT coalesce(sum(amount), 0)::int AS total FROM transactions
     WHERE user_id = $1 AND currency = $2 AND status IN ('pending', 'completed') AND created_at >= date_trunc('month', now())`,
    [userId, currency],
  );
  return row?.total ?? 0;
}

export async function spendCap(db: Db, userId: string): Promise<number | null> {
  const [row] = await db.query<{ monthly_spend_cap: number | null }>('SELECT monthly_spend_cap FROM users WHERE id = $1', [userId]);
  return row?.monthly_spend_cap ?? null;
}

export async function setSpendCap(db: Db, userId: string, cap: number | null): Promise<void> {
  await db.query('UPDATE users SET monthly_spend_cap = $2 WHERE id = $1', [userId, cap]);
}

/**
 * Passage en caisse : transaction en attente, puis page de paiement du prestataire. Une piste de pass est
 * liée à la saison en cours, et seulement si le joueur peut l'acheter (pas deux fois, passage au deluxe).
 */
export async function checkout(
  db: Db,
  provider: PaymentProvider,
  user: { id: string; country: string },
  productId: string,
  pass: PassConfig,
  returnPath = '/shop',
): Promise<{ url: string; transactionId: string }> {
  const offer = (await listOffers(db, user.country, null)).find((o) => o.id === productId);
  if (!offer) throw new EconomyError('unknown_product', 404);
  const [product] = await db.query<{ type: string; contents: Record<string, unknown> }>('SELECT type, contents FROM products WHERE id = $1', [productId]);
  const contents = product!.type === 'pass' ? { ...product!.contents, season: await assertPassPurchasable(db, user.id, productId, pass) } : { gems: offer.gems };
  const cap = await spendCap(db, user.id);
  // Les achats en attente comptent aussi : on ne dépasse pas le plafond en ouvrant plusieurs paiements.
  if (cap !== null && (await monthSpent(db, user.id, offer.currency)) + offer.amount > cap) throw new EconomyError('spend_cap_reached', 403);

  const [tx] = await db.query<{ id: string }>(
    `INSERT INTO transactions (user_id, product_id, contents, provider, amount, currency) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [user.id, offer.id, JSON.stringify(contents), provider.name, offer.amount, offer.currency],
  );
  const session = await provider.createCheckout({
    transactionId: tx!.id,
    userId: user.id,
    productId: offer.id,
    label: offer.name.en ?? offer.id,
    amount: offer.amount,
    currency: offer.currency,
    returnPath,
  });
  await db.query('UPDATE transactions SET provider_session_id = $2 WHERE id = $1', [tx!.id, session.sessionId]);
  return { url: session.url, transactionId: tx!.id };
}

/** Le joueur abandonne la page de paiement : la transaction en attente est annulée. */
export async function cancelPending(db: Db, userId: string, provider: string, sessionId: string): Promise<void> {
  await db.query("UPDATE transactions SET status = 'cancelled' WHERE user_id = $1 AND provider = $2 AND provider_session_id = $3 AND status = 'pending'", [
    userId,
    provider,
    sessionId,
  ]);
}

const gemsOf = (contents: unknown) => Number((contents as { gems?: number }).gems ?? 0);
const passOf = (contents: unknown) => {
  const c = contents as { pass?: 'premium' | 'deluxe'; season?: number };
  return c.pass && c.season ? { track: c.pass, season: c.season } : null;
};

/**
 * Traitement d'un webhook vérifié, idempotent : un événement déjà reçu ne fait rien ; un paiement n'est
 * crédité que si sa transaction est encore en attente et que le montant et la devise correspondent.
 * Remboursement ou rétrofacturation : les gemmes sont retirées (le solde peut devenir négatif).
 */
export async function applyEvent(db: Db, provider: string, event: PaymentEvent): Promise<'applied' | 'duplicate' | 'ignored'> {
  return db.transaction(async (tx) => {
    const fresh = await tx.query('INSERT INTO payment_events (provider, event_id, type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1', [provider, event.id, event.type]);
    if (fresh.length === 0) return 'duplicate';

    if (event.type === 'payment_succeeded') {
      const [t] = await tx.query<{ id: string; user_id: string; amount: number; currency: string; contents: unknown; status: string }>(
        'SELECT id, user_id, amount, currency, contents, status FROM transactions WHERE provider = $1 AND provider_session_id = $2',
        [provider, event.sessionId],
      );
      if (!t || t.status !== 'pending') return 'ignored';
      if (t.amount !== event.amount || t.currency !== event.currency) {
        await tx.query("UPDATE transactions SET status = 'mismatch', provider_transaction_id = $2 WHERE id = $1", [t.id, event.providerTransactionId]);
        await tx.query("INSERT INTO admin_audit (admin_id, action, target, payload) VALUES (NULL, 'payment.mismatch', $1, $2)", [t.id, JSON.stringify(event)]);
        return 'ignored';
      }
      await tx.query("UPDATE transactions SET status = 'completed', provider_transaction_id = $2, completed_at = now() WHERE id = $1", [t.id, event.providerTransactionId]);
      const pass = passOf(t.contents);
      if (pass) {
        await setTrack(tx, t.user_id, pass.season, pass.track);
        return 'applied';
      }
      const gems = gemsOf(t.contents);
      await tx.query('UPDATE wallets SET gems = gems + $2 WHERE user_id = $1', [t.user_id, gems]);
      await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'gems', $2, 'purchase', $3)", [t.user_id, gems, t.id]);
      return 'applied';
    }

    const [t] = await tx.query<{ id: string; user_id: string; contents: unknown }>(
      "SELECT id, user_id, contents FROM transactions WHERE provider = $1 AND provider_transaction_id = $2 AND status = 'completed'",
      [provider, event.providerTransactionId],
    );
    if (!t) return 'ignored';
    await tx.query('UPDATE transactions SET status = $2, refunded_at = now() WHERE id = $1', [t.id, event.type]);
    const pass = passOf(t.contents);
    if (pass) {
      // Piste retirée : elle redevient celle des achats encore valables de la saison.
      await recomputeTrack(tx, t.user_id, pass.season);
    } else {
      const gems = gemsOf(t.contents);
      await tx.query('UPDATE wallets SET gems = gems - $2 WHERE user_id = $1', [t.user_id, gems]);
      await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'gems', $2, $3, $4)", [t.user_id, -gems, event.type, t.id]);
    }
    // Une rétrofacturation est signalée pour revue (fraude possible).
    if (event.type === 'chargeback') await tx.query("INSERT INTO admin_audit (admin_id, action, target, payload) VALUES (NULL, 'payment.chargeback', $1, $2)", [t.user_id, JSON.stringify({ transaction: t.id })]);
    return 'applied';
  });
}

/** Historique d'achats (transparence, section 14). */
export async function listPurchases(db: Db, userId: string): Promise<Purchase[]> {
  const rows = await db.query<{ id: string; product_id: string; name: Record<string, string>; contents: unknown; amount: number; currency: string; status: Purchase['status']; created_at: string | Date }>(
    `SELECT t.id, t.product_id, p.name, t.contents, t.amount, t.currency, t.status, t.created_at
     FROM transactions t JOIN products p ON p.id = t.product_id
     WHERE t.user_id = $1 AND t.status <> 'cancelled' ORDER BY t.created_at DESC LIMIT 50`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    name: r.name,
    gems: gemsOf(r.contents),
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
