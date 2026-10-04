import type { CatalogSnapshot } from '../catalog/catalog.js';
import type { EconomyConfig } from '../config.js';
import type { Db } from '../db/db.js';
import type { FriendDto, FriendsDto, TradeDto } from '@rabbithole/shared';
import { EconomyError } from '../economy/economy.js';
import { sameGuild } from '../guilds/guilds.js';

/**
 * Amis et échanges entre joueurs (section 6.5). Amitié : demande puis acceptation, sans délai avant
 * de pouvoir échanger. Échange libre entre amis (décision du 2026-10-03) : plusieurs cartes de chaque
 * côté, raretés libres, dons compris, sans limite ; aucune monnaie. Seules règles : être amis, posséder
 * les cartes, cartes autorisées dans les deux pays, et tout est revérifié à l'acceptation.
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

/** Échanges permis entre amis et entre membres d'une même guilde. */
export async function canTrade(db: Db, a: string, b: string): Promise<boolean> {
  return (await areFriends(db, a, b)) || (await sameGuild(db, a, b));
}

/** Cartes d'un ami ou d'un membre de ma guilde, pour lui proposer un échange. */
export async function friendCollection(db: Db, userId: string, friendId: string): Promise<{ cardId: string; quantity: number }[]> {
  if (!(await canTrade(db, userId, friendId))) throw new EconomyError('not_friends', 403);
  const rows = await db.query<{ card_id: string; quantity: number }>('SELECT card_id, quantity FROM collections WHERE user_id = $1 AND quantity > 0 ORDER BY card_id', [
    friendId,
  ]);
  return rows.map((r) => ({ cardId: r.card_id, quantity: r.quantity }));
}

// --- Échanges ---

export type TradeItem = { cardId: string; quantity: number };

interface TradeRow {
  id: string;
  from_user: string;
  to_user: string;
  from_name: string;
  to_name: string;
  status: TradeDto['status'];
  created_at: string | Date;
  expires_at: string | Date;
  resolved_at: string | Date | null;
}

const TRADE_SELECT = `SELECT t.*, fu.display_name AS from_name, tu.display_name AS to_name
  FROM trades t JOIN users fu ON fu.id = t.from_user JOIN users tu ON tu.id = t.to_user`;

/** Cartes de chaque proposition, côté donné et côté demandé. */
async function itemsOf(db: Db, ids: string[]): Promise<Map<string, { offered: TradeItem[]; requested: TradeItem[] }>> {
  const map = new Map(ids.map((id) => [id, { offered: [] as TradeItem[], requested: [] as TradeItem[] }]));
  if (!ids.length) return map;
  const rows = await db.query<{ trade_id: string; side: 'offered' | 'requested'; card_id: string; quantity: number }>(
    'SELECT trade_id, side, card_id, quantity FROM trade_items WHERE trade_id = ANY($1::uuid[]) ORDER BY card_id',
    [ids],
  );
  for (const r of rows) map.get(r.trade_id)?.[r.side].push({ cardId: r.card_id, quantity: r.quantity });
  return map;
}

async function tradeDtos(db: Db, rows: TradeRow[]): Promise<TradeDto[]> {
  const items = await itemsOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    fromUser: { id: r.from_user, name: r.from_name },
    toUser: { id: r.to_user, name: r.to_name },
    offered: items.get(r.id)!.offered,
    requested: items.get(r.id)!.requested,
    status: r.status,
    createdAt: iso(r.created_at)!,
    expiresAt: iso(r.expires_at)!,
    resolvedAt: iso(r.resolved_at),
  }));
}

const tradeById = async (db: Db, id: string) => (await tradeDtos(db, await db.query<TradeRow>(`${TRADE_SELECT} WHERE t.id = $1`, [id])))[0]!;

/** Les propositions dont le délai est passé deviennent « expirées ». */
async function expireTrades(db: Db): Promise<void> {
  await db.query("UPDATE trades SET status = 'expired', resolved_at = now() WHERE status = 'pending' AND expires_at <= now()");
}

export async function listTrades(db: Db, userId: string): Promise<{ incoming: TradeDto[]; outgoing: TradeDto[]; history: TradeDto[] }> {
  await expireTrades(db);
  const rows = await db.query<TradeRow>(`${TRADE_SELECT} WHERE t.from_user = $1 OR t.to_user = $1 ORDER BY t.created_at DESC LIMIT 100`, [userId]);
  const all = await tradeDtos(db, rows);
  const pending = all.filter((r) => r.status === 'pending');
  return {
    incoming: pending.filter((r) => r.toUser.id === userId),
    outgoing: pending.filter((r) => r.fromUser.id === userId),
    history: all.filter((r) => r.status !== 'pending').slice(0, 30),
  };
}

const quantity = async (db: Db, userId: string, cardId: string) =>
  (await db.query<{ quantity: number }>('SELECT quantity FROM collections WHERE user_id = $1 AND card_id = $2', [userId, cardId]))[0]?.quantity ?? 0;

/** Carte publiée et obtenable par les deux joueurs (règles de leurs pays). */
function checkTradable(cardId: string, catalogs: CatalogSnapshot[]): void {
  if (catalogs.some((c) => ![...c.collectibles, ...c.leaders].some((d) => d.id === cardId))) throw new EconomyError('unknown_card', 404);
}

/** Regroupe les cartes d'un côté (une carte citée deux fois voit ses quantités additionnées). */
function merge(items: TradeItem[]): TradeItem[] {
  const map = new Map<string, number>();
  for (const i of items) map.set(i.cardId, (map.get(i.cardId) ?? 0) + i.quantity);
  return [...map].map(([cardId, quantity]) => ({ cardId, quantity }));
}

/** Chaque joueur possède encore les exemplaires qu'il donne. */
async function checkOwnership(db: Db, fromUser: string, toUser: string, offered: TradeItem[], requested: TradeItem[]): Promise<void> {
  for (const i of offered) if ((await quantity(db, fromUser, i.cardId)) < i.quantity) throw new EconomyError('not_owned', 409);
  for (const i of requested) if ((await quantity(db, toUser, i.cardId)) < i.quantity) throw new EconomyError('not_owned_by_friend', 409);
}

/**
 * Proposition d'échange entre amis (ou membres d'une même guilde) : des cartes données et des cartes demandées, raretés libres ;
 * l'un des deux côtés peut être vide (don, ou demande de don). Rien ne bouge avant l'acceptation.
 */
export async function proposeTrade(
  db: Db,
  userId: string,
  input: { toUserId: string; offered: TradeItem[]; requested: TradeItem[] },
  economy: EconomyConfig,
  catalogs: { mine: CatalogSnapshot; theirs: CatalogSnapshot },
): Promise<TradeDto> {
  if (input.toUserId === userId) throw new EconomyError('self');
  if (!(await canTrade(db, userId, input.toUserId))) throw new EconomyError('not_friends', 403);
  const offered = merge(input.offered);
  const requested = merge(input.requested);
  if (offered.length + requested.length === 0) throw new EconomyError('empty_trade');
  if (offered.some((o) => requested.some((r) => r.cardId === o.cardId))) throw new EconomyError('same_card');
  for (const i of [...offered, ...requested]) checkTradable(i.cardId, [catalogs.mine, catalogs.theirs]);
  await checkOwnership(db, userId, input.toUserId, offered, requested);
  const [pending] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM trades WHERE from_user = $1 AND status = 'pending'", [userId]);
  if ((pending?.n ?? 0) >= MAX_PENDING_TRADES) throw new EconomyError('too_many_pending', 429);

  return db.transaction(async (tx) => {
    const [row] = await tx.query<{ id: string }>(
      `INSERT INTO trades (from_user, to_user, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3)) RETURNING id`,
      [userId, input.toUserId, economy.trades.expiryHours],
    );
    for (const [side, items] of [
      ['offered', offered],
      ['requested', requested],
    ] as const) {
      for (const i of items) await tx.query('INSERT INTO trade_items (trade_id, side, card_id, quantity) VALUES ($1, $2, $3, $4)', [row!.id, side, i.cardId, i.quantity]);
    }
    return tradeById(tx, row!.id);
  });
}

async function pendingTrade(db: Db, tradeId: string): Promise<TradeDto> {
  await expireTrades(db);
  const [row] = await db.query<TradeRow>(`${TRADE_SELECT} WHERE t.id = $1`, [tradeId]);
  if (!row) throw new EconomyError('unknown_trade', 404);
  if (row.status === 'expired') throw new EconomyError('trade_expired', 410);
  if (row.status !== 'pending') throw new EconomyError('trade_closed', 409);
  return (await tradeDtos(db, [row]))[0]!;
}

async function move(db: Db, from: string, to: string, item: TradeItem, tradeId: string): Promise<void> {
  const done = await db.query('UPDATE collections SET quantity = quantity - $3 WHERE user_id = $1 AND card_id = $2 AND quantity >= $3 RETURNING quantity', [
    from,
    item.cardId,
    item.quantity,
  ]);
  if (done.length === 0) throw new EconomyError('not_owned', 409);
  await db.query('DELETE FROM collections WHERE user_id = $1 AND card_id = $2 AND quantity <= 0', [from, item.cardId]);
  await db.query(
    `INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = collections.quantity + EXCLUDED.quantity`,
    [to, item.cardId, item.quantity],
  );
  for (const [user, amount] of [
    [from, -item.quantity],
    [to, item.quantity],
  ] as const) {
    await db.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'cards', $2, 'trade', $3)", [user, amount, `${tradeId}:${item.cardId}`]);
  }
}

/**
 * Une carte donnée quitte les decks de son ancien propriétaire : on retire les exemplaires qu'il n'a plus.
 * Un Leader donné reste en tête du deck, qui ne sera jouable qu'avec un autre Leader.
 */
export async function trimDecks(db: Db, userId: string, cardIds: string[]): Promise<void> {
  const decks = await db.query<{ id: string; card_ids: string[] }>('SELECT id, card_ids FROM decks WHERE user_id = $1 AND card_ids && $2::text[]', [userId, cardIds]);
  for (const deck of decks) {
    const left = new Map<string, number>();
    for (const id of new Set(deck.card_ids)) left.set(id, cardIds.includes(id) ? await quantity(db, userId, id) : Infinity);
    const kept = deck.card_ids.filter((id) => {
      const n = left.get(id)!;
      left.set(id, n - 1);
      return n > 0;
    });
    if (kept.length !== deck.card_ids.length) await db.query('UPDATE decks SET card_ids = $2, updated_at = now() WHERE id = $1', [deck.id, kept]);
  }
}

/** Acceptation par le destinataire : tout est revérifié, puis les cartes changent de main d'un coup. */
export async function acceptTrade(db: Db, userId: string, tradeId: string, catalogs: { mine: CatalogSnapshot; theirs: CatalogSnapshot }): Promise<TradeDto> {
  return db.transaction(async (tx) => {
    const t = await pendingTrade(tx, tradeId);
    if (t.toUser.id !== userId) throw new EconomyError('not_your_trade', 403);
    if (!(await canTrade(tx, t.fromUser.id, t.toUser.id))) throw new EconomyError('not_friends', 403);
    for (const i of [...t.offered, ...t.requested]) checkTradable(i.cardId, [catalogs.mine, catalogs.theirs]);
    await checkOwnership(tx, t.fromUser.id, t.toUser.id, t.offered, t.requested);
    for (const i of t.offered) await move(tx, t.fromUser.id, t.toUser.id, i, t.id);
    for (const i of t.requested) await move(tx, t.toUser.id, t.fromUser.id, i, t.id);
    await trimDecks(
      tx,
      t.fromUser.id,
      t.offered.map((i) => i.cardId),
    );
    await trimDecks(
      tx,
      t.toUser.id,
      t.requested.map((i) => i.cardId),
    );
    await tx.query("UPDATE trades SET status = 'accepted', resolved_at = now() WHERE id = $1", [t.id]);
    return tradeById(tx, t.id);
  });
}

/** Refus (destinataire) ou annulation (auteur) d'une proposition en attente. */
export async function closeTrade(db: Db, userId: string, tradeId: string, action: 'decline' | 'cancel'): Promise<void> {
  const t = await pendingTrade(db, tradeId);
  if ((action === 'decline' ? t.toUser.id : t.fromUser.id) !== userId) throw new EconomyError('not_your_trade', 403);
  await db.query('UPDATE trades SET status = $2, resolved_at = now() WHERE id = $1', [t.id, action === 'decline' ? 'declined' : 'cancelled']);
}
