import type { CardDef, Rarity } from '@rabbithole/engine';
import { linkedAccounts } from '../auth/antiabuse.js';
import type { CatalogSnapshot } from '../catalog/catalog.js';
import type { EconomyConfig } from '../config.js';
import type { Db } from '../db/db.js';
import type { FriendDto, FriendsDto, TradeDto } from '@rabbithole/shared';
import { EconomyError } from '../economy/economy.js';

/**
 * Amis et échanges entre joueurs (section 6.5). Amitié : demande puis acceptation, sans délai avant
 * de pouvoir échanger. Échange : 1 carte contre 1, même rareté, aucune monnaie ; interdit entre comptes
 * liés (même appareil ou même réseau) ; limites par jour et pour les GOAT par semaine (config).
 */

/** Demandes d'amitié en attente qu'un joueur peut avoir envoyées (anti-spam). */
const MAX_OUTGOING_REQUESTS = 50;
/** Propositions d'échange en attente qu'un joueur peut avoir envoyées. */
const MAX_PENDING_TRADES = 20;

const iso = (d: string | Date | null) => (d === null ? null : new Date(d).toISOString());

export async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  const [row] = await db.query(
    `SELECT 1 FROM friendships WHERE accepted_at IS NOT NULL
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
    [a, b],
  );
  return !!row;
}

export async function listFriends(db: Db, userId: string): Promise<FriendsDto> {
  const [me] = await db.query<{ friend_code: string }>('SELECT friend_code FROM users WHERE id = $1', [userId]);
  const rows = await db.query<{ requester_id: string; addressee_id: string; accepted_at: string | Date | null; other_id: string; other_name: string }>(
    `SELECT f.requester_id, f.addressee_id, f.accepted_at, u.id AS other_id, u.display_name AS other_name
     FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     WHERE f.requester_id = $1 OR f.addressee_id = $1
     ORDER BY u.display_name`,
    [userId],
  );
  const dto = (r: (typeof rows)[number]): FriendDto => ({ id: r.other_id, name: r.other_name, since: iso(r.accepted_at) });
  return {
    code: me?.friend_code ?? '',
    friends: rows.filter((r) => r.accepted_at).map(dto),
    incoming: rows.filter((r) => !r.accepted_at && r.addressee_id === userId).map(dto),
    outgoing: rows.filter((r) => !r.accepted_at && r.requester_id === userId).map(dto),
  };
}

/**
 * Demande d'amitié par code ami, ou par pseudo s'il est unique. Si l'autre joueur avait déjà fait
 * la demande, elle est acceptée : les deux sont amis.
 */
export async function requestFriend(db: Db, userId: string, target: { code?: string; name?: string }): Promise<{ id: string; name: string; accepted: boolean }> {
  const found = target.code
    ? await db.query<{ id: string; display_name: string }>('SELECT id, display_name FROM users WHERE friend_code = upper($1)', [target.code.trim()])
    : await db.query<{ id: string; display_name: string }>('SELECT id, display_name FROM users WHERE lower(display_name) = lower($1) LIMIT 2', [(target.name ?? '').trim()]);
  if (found.length === 0) throw new EconomyError('player_not_found', 404);
  if (found.length > 1) throw new EconomyError('ambiguous_name', 409);
  const other = found[0]!;
  if (other.id === userId) throw new EconomyError('self');

  return db.transaction(async (tx) => {
    const [existing] = await tx.query<{ requester_id: string; accepted_at: string | null }>(
      `SELECT requester_id, accepted_at FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [userId, other.id],
    );
    if (existing?.accepted_at) throw new EconomyError('already_friends', 409);
    if (existing?.requester_id === userId) throw new EconomyError('already_requested', 409);
    if (existing) {
      await tx.query('UPDATE friendships SET accepted_at = now() WHERE requester_id = $1 AND addressee_id = $2', [other.id, userId]);
      return { id: other.id, name: other.display_name, accepted: true };
    }
    const [pending] = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM friendships WHERE requester_id = $1 AND accepted_at IS NULL', [userId]);
    if ((pending?.n ?? 0) >= MAX_OUTGOING_REQUESTS) throw new EconomyError('too_many_requests', 429);
    await tx.query('INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)', [userId, other.id]);
    return { id: other.id, name: other.display_name, accepted: false };
  });
}

export async function acceptFriend(db: Db, userId: string, requesterId: string): Promise<void> {
  const done = await db.query('UPDATE friendships SET accepted_at = now() WHERE requester_id = $1 AND addressee_id = $2 AND accepted_at IS NULL RETURNING 1', [
    requesterId,
    userId,
  ]);
  if (done.length === 0) throw new EconomyError('no_request', 404);
}

/** Refuse une demande, annule la sienne ou retire un ami ; les échanges en attente entre eux sont annulés. */
export async function removeFriend(db: Db, userId: string, otherId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const gone = await tx.query(
      `DELETE FROM friendships WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1) RETURNING 1`,
      [userId, otherId],
    );
    if (gone.length === 0) throw new EconomyError('not_friends', 404);
    await tx.query(
      `UPDATE trades SET status = 'cancelled', resolved_at = now()
       WHERE status = 'pending' AND ((from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1))`,
      [userId, otherId],
    );
  });
}

/** Cartes d'un ami, pour lui proposer un échange (amis uniquement). */
export async function friendCollection(db: Db, userId: string, friendId: string): Promise<{ cardId: string; quantity: number }[]> {
  if (!(await areFriends(db, userId, friendId))) throw new EconomyError('not_friends', 403);
  const rows = await db.query<{ card_id: string; quantity: number }>('SELECT card_id, quantity FROM collections WHERE user_id = $1 AND quantity > 0 ORDER BY card_id', [
    friendId,
  ]);
  return rows.map((r) => ({ cardId: r.card_id, quantity: r.quantity }));
}

// --- Échanges ---

interface TradeRow {
  id: string;
  from_user: string;
  to_user: string;
  from_name: string;
  to_name: string;
  offered_card_id: string;
  requested_card_id: string;
  rarity: Rarity;
  status: TradeDto['status'];
  created_at: string | Date;
  expires_at: string | Date;
  resolved_at: string | Date | null;
}

const TRADE_SELECT = `SELECT t.*, fu.display_name AS from_name, tu.display_name AS to_name
  FROM trades t JOIN users fu ON fu.id = t.from_user JOIN users tu ON tu.id = t.to_user`;

const tradeDto = (r: TradeRow): TradeDto => ({
  id: r.id,
  fromUser: { id: r.from_user, name: r.from_name },
  toUser: { id: r.to_user, name: r.to_name },
  offeredCardId: r.offered_card_id,
  requestedCardId: r.requested_card_id,
  rarity: r.rarity,
  status: r.status,
  createdAt: iso(r.created_at)!,
  expiresAt: iso(r.expires_at)!,
  resolvedAt: iso(r.resolved_at),
});

/** Les propositions dont le délai est passé deviennent « expirées ». */
async function expireTrades(db: Db): Promise<void> {
  await db.query("UPDATE trades SET status = 'expired', resolved_at = now() WHERE status = 'pending' AND expires_at <= now()");
}

export async function listTrades(db: Db, userId: string): Promise<{ incoming: TradeDto[]; outgoing: TradeDto[]; history: TradeDto[] }> {
  await expireTrades(db);
  const rows = await db.query<TradeRow>(`${TRADE_SELECT} WHERE t.from_user = $1 OR t.to_user = $1 ORDER BY t.created_at DESC LIMIT 100`, [userId]);
  const pending = rows.filter((r) => r.status === 'pending');
  return {
    incoming: pending.filter((r) => r.to_user === userId).map(tradeDto),
    outgoing: pending.filter((r) => r.from_user === userId).map(tradeDto),
    history: rows.filter((r) => r.status !== 'pending').slice(0, 30).map(tradeDto),
  };
}

const quantity = async (db: Db, userId: string, cardId: string) =>
  (await db.query<{ quantity: number }>('SELECT quantity FROM collections WHERE user_id = $1 AND card_id = $2', [userId, cardId]))[0]?.quantity ?? 0;

/** Limites d'échanges acceptés d'un joueur : par jour, et pour les GOAT par semaine. */
async function checkLimits(db: Db, userId: string, rarity: Rarity, economy: EconomyConfig): Promise<void> {
  const [row] = await db.query<{ day: number; goat_week: number }>(
    `SELECT count(*) FILTER (WHERE resolved_at > now() - interval '1 day')::int AS day,
            count(*) FILTER (WHERE rarity = 'goat' AND resolved_at > now() - interval '7 days')::int AS goat_week
     FROM trades WHERE status = 'accepted' AND (from_user = $1 OR to_user = $1)`,
    [userId],
  );
  if ((row?.day ?? 0) >= economy.trades.perDay) throw new EconomyError('daily_limit', 429);
  if (rarity === 'goat' && (row?.goat_week ?? 0) >= economy.trades.goatPerWeek) throw new EconomyError('goat_weekly_limit', 429);
}

/** Amis, et pas comptes liés (même appareil ou même réseau, section 14). */
async function checkPartners(db: Db, a: string, b: string): Promise<void> {
  if (!(await areFriends(db, a, b))) throw new EconomyError('not_friends', 403);
  if ((await linkedAccounts(db, a)).includes(b)) throw new EconomyError('linked_accounts', 403);
}

/** Carte publiée et obtenable par les deux joueurs (règles de leurs pays). */
function tradable(cardId: string, catalogs: CatalogSnapshot[]): CardDef {
  const defs = catalogs.map((c) => [...c.collectibles, ...c.leaders].find((d) => d.id === cardId));
  if (defs.some((d) => !d)) throw new EconomyError('unknown_card', 404);
  return defs[0]!;
}

/**
 * Proposition d'échange : ma carte contre une carte de mon ami, de même rareté. Rien ne bouge avant
 * son acceptation ; tout est revérifié à ce moment-là.
 */
export async function proposeTrade(
  db: Db,
  userId: string,
  input: { toUserId: string; offeredCardId: string; requestedCardId: string },
  economy: EconomyConfig,
  catalogs: { mine: CatalogSnapshot; theirs: CatalogSnapshot },
): Promise<TradeDto> {
  if (input.toUserId === userId) throw new EconomyError('self');
  await checkPartners(db, userId, input.toUserId);
  if (input.offeredCardId === input.requestedCardId) throw new EconomyError('same_card');
  const both = [catalogs.mine, catalogs.theirs];
  const offered = tradable(input.offeredCardId, both);
  const requested = tradable(input.requestedCardId, both);
  if (offered.rarity !== requested.rarity) throw new EconomyError('rarity_mismatch');
  if ((await quantity(db, userId, offered.id)) < 1) throw new EconomyError('not_owned');
  if ((await quantity(db, input.toUserId, requested.id)) < 1) throw new EconomyError('not_owned_by_friend');
  await checkLimits(db, userId, offered.rarity, economy);
  const [pending] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM trades WHERE from_user = $1 AND status = 'pending'", [userId]);
  if ((pending?.n ?? 0) >= MAX_PENDING_TRADES) throw new EconomyError('too_many_pending', 429);

  const [row] = await db.query<{ id: string }>(
    `INSERT INTO trades (from_user, to_user, offered_card_id, requested_card_id, rarity, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6)) RETURNING id`,
    [userId, input.toUserId, offered.id, requested.id, offered.rarity, economy.trades.expiryHours],
  );
  return tradeDto((await db.query<TradeRow>(`${TRADE_SELECT} WHERE t.id = $1`, [row!.id]))[0]!);
}

async function pendingTrade(db: Db, tradeId: string): Promise<TradeRow> {
  await expireTrades(db);
  const [row] = await db.query<TradeRow>(`${TRADE_SELECT} WHERE t.id = $1`, [tradeId]);
  if (!row) throw new EconomyError('unknown_trade', 404);
  if (row.status === 'expired') throw new EconomyError('trade_expired', 410);
  if (row.status !== 'pending') throw new EconomyError('trade_closed', 409);
  return row;
}

const takeOne = async (db: Db, userId: string, cardId: string) => {
  const done = await db.query('UPDATE collections SET quantity = quantity - 1 WHERE user_id = $1 AND card_id = $2 AND quantity >= 1 RETURNING quantity', [userId, cardId]);
  if (done.length === 0) return false;
  await db.query('DELETE FROM collections WHERE user_id = $1 AND card_id = $2 AND quantity <= 0', [userId, cardId]);
  return true;
};

const giveOne = (db: Db, userId: string, cardId: string) =>
  db.query(
    `INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, 1)
     ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = collections.quantity + 1`,
    [userId, cardId],
  );

/** Acceptation par le destinataire : tout est revérifié, puis les deux cartes changent de main d'un coup. */
export async function acceptTrade(
  db: Db,
  userId: string,
  tradeId: string,
  economy: EconomyConfig,
  catalogs: { mine: CatalogSnapshot; theirs: CatalogSnapshot },
): Promise<TradeDto> {
  return db.transaction(async (tx) => {
    const t = await pendingTrade(tx, tradeId);
    if (t.to_user !== userId) throw new EconomyError('not_your_trade', 403);
    await checkPartners(tx, t.from_user, t.to_user);
    const both = [catalogs.mine, catalogs.theirs];
    tradable(t.offered_card_id, both);
    tradable(t.requested_card_id, both);
    await checkLimits(tx, t.from_user, t.rarity, economy);
    await checkLimits(tx, t.to_user, t.rarity, economy);
    if (!(await takeOne(tx, t.from_user, t.offered_card_id))) throw new EconomyError('not_owned_by_friend', 409);
    if (!(await takeOne(tx, t.to_user, t.requested_card_id))) throw new EconomyError('not_owned', 409);
    await giveOne(tx, t.to_user, t.offered_card_id);
    await giveOne(tx, t.from_user, t.requested_card_id);
    for (const [user, card, amount] of [
      [t.from_user, t.offered_card_id, -1],
      [t.from_user, t.requested_card_id, 1],
      [t.to_user, t.requested_card_id, -1],
      [t.to_user, t.offered_card_id, 1],
    ] as const) {
      await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'cards', $2, 'trade', $3)", [user, amount, `${t.id}:${card}`]);
    }
    await tx.query("UPDATE trades SET status = 'accepted', resolved_at = now() WHERE id = $1", [t.id]);
    return tradeDto((await tx.query<TradeRow>(`${TRADE_SELECT} WHERE t.id = $1`, [t.id]))[0]!);
  });
}

/** Refus (destinataire) ou annulation (auteur) d'une proposition en attente. */
export async function closeTrade(db: Db, userId: string, tradeId: string, action: 'decline' | 'cancel'): Promise<void> {
  const t = await pendingTrade(db, tradeId);
  if ((action === 'decline' ? t.to_user : t.from_user) !== userId) throw new EconomyError('not_your_trade', 403);
  await db.query('UPDATE trades SET status = $2, resolved_at = now() WHERE id = $1', [t.id, action === 'decline' ? 'declined' : 'cancelled']);
}
