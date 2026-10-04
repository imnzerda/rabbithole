import { randomUUID } from 'node:crypto';
import { CATEGORY_NAMES } from '@rabbithole/engine';
import type { GuildDto, GuildRole, GuildSummaryDto, MyGuildDto } from '@rabbithole/shared';
import type { CatalogSnapshot } from '../catalog/catalog.js';
import type { GuildsConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { trimDecks } from '../social/social.js';

/**
 * Guildes (section 13) : création, recherche, adhésion (libre ou sur demande), départ, rôles ;
 * XP et niveaux (bonus de pièces, capacité), demandes de cartes et dons, tableau d'échanges.
 * - Une guilde par joueur. Le chef gère tout ; un adjoint accepte les demandes et exclut les simples membres.
 * - Le chef qui part passe la main au plus ancien adjoint, sinon au plus ancien membre ; une guilde vide est dissoute.
 * - Capacité : `capacity.base`, puis `capacity.boosted` à partir du niveau `capacity.boostLevel`.
 */

export class GuildError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}

export interface GuildSettings {
  description: string;
  emblem: string;
  language: string;
  open: boolean;
}

interface GuildRow {
  id: string;
  name: string;
  description: string;
  emblem: string;
  language: string;
  open: boolean;
  level: number;
  members: number;
}

export const isEmblem = (e: string) => e in CATEGORY_NAMES;
/** Nom normalisé pour l'unicité (casse et espaces ignorés). */
const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export const guildCapacity = (level: number, config: GuildsConfig) => (level >= config.capacity.boostLevel ? config.capacity.boosted : config.capacity.base);

const SUMMARY = `SELECT g.id, g.name, g.description, g.emblem, g.language, g.open, g.level,
  (SELECT count(*)::int FROM guild_members m WHERE m.guild_id = g.id) AS members FROM guilds g`;

function toSummary(g: GuildRow, config: GuildsConfig): GuildSummaryDto {
  return { id: g.id, name: g.name, description: g.description, emblem: g.emblem, language: g.language, open: g.open, level: g.level, members: g.members, capacity: guildCapacity(g.level, config) };
}

async function membership(db: Db, userId: string): Promise<{ guild_id: string; role: GuildRole } | null> {
  const [m] = await db.query<{ guild_id: string; role: GuildRole }>('SELECT guild_id, role FROM guild_members WHERE user_id = $1', [userId]);
  return m ?? null;
}

async function notify(db: Db, userId: string, kind: string, payload: Record<string, unknown>): Promise<void> {
  await db.query('INSERT INTO notices (user_id, kind, payload) VALUES ($1, $2, $3)', [userId, kind, JSON.stringify(payload)]);
}

function checkSettings(s: GuildSettings, config: GuildsConfig): void {
  if (!isEmblem(s.emblem)) throw new GuildError('invalid_emblem');
  if (!config.languages.includes(s.language)) throw new GuildError('invalid_language');
}

export async function createGuild(db: Db, userId: string, name: string, settings: GuildSettings, config: GuildsConfig): Promise<string> {
  checkSettings(settings, config);
  const clean = name.trim().replace(/\s+/g, ' ');
  if (await membership(db, userId)) throw new GuildError('already_in_guild', 409);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const [taken] = await tx.query('SELECT 1 FROM guilds WHERE name_key = $1', [nameKey(clean)]);
    if (taken) throw new GuildError('guild_name_taken', 409);
    if (config.creationCoins > 0) {
      const paid = await tx.query('UPDATE wallets SET coins = coins - $2 WHERE user_id = $1 AND coins >= $2 RETURNING coins', [userId, config.creationCoins]);
      if (paid.length === 0) throw new GuildError('not_enough_coins', 402);
      await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'guild_create', $3)", [userId, -config.creationCoins, id]);
    }
    await tx.query('INSERT INTO guilds (id, name, name_key, description, emblem, language, open) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      id,
      clean,
      nameKey(clean),
      settings.description.trim(),
      settings.emblem,
      settings.language,
      settings.open,
    ]);
    await tx.query("INSERT INTO guild_members (guild_id, user_id, role) VALUES ($1, $2, 'leader')", [id, userId]);
    await tx.query('DELETE FROM guild_join_requests WHERE user_id = $1', [userId]);
  });
  return id;
}

/** Recherche par nom (ou les plus peuplées), langue en option. */
export async function searchGuilds(db: Db, query: string, language: string | null, config: GuildsConfig): Promise<GuildSummaryDto[]> {
  const q = nameKey(query);
  const rows = await db.query<GuildRow>(
    `SELECT * FROM (${SUMMARY}) s WHERE ($1 = '' OR s.id IN (SELECT id FROM guilds WHERE name_key LIKE '%' || $1 || '%')) AND ($2::text IS NULL OR s.language = $2)
     ORDER BY s.members DESC, s.name LIMIT 30`,
    [q, language],
  );
  return rows.map((g) => toSummary(g, config));
}

export async function guildSummary(db: Db, guildId: string, config: GuildsConfig): Promise<GuildSummaryDto | null> {
  const [g] = await db.query<GuildRow>(`${SUMMARY} WHERE g.id = $1`, [guildId]);
  return g ? toSummary(g, config) : null;
}

export async function myGuild(db: Db, userId: string, config: GuildsConfig, now = new Date()): Promise<MyGuildDto> {
  const m = await membership(db, userId);
  const pending = (await db.query<{ guild_id: string }>('SELECT guild_id FROM guild_join_requests WHERE user_id = $1', [userId])).map((r) => r.guild_id);
  const base = { pending, creationCoins: config.creationCoins, languages: config.languages };
  if (!m) return { guild: null, ...base };
  const summary = (await guildSummary(db, m.guild_id, config))!;
  const roster = await db.query<{ user_id: string; display_name: string; role: GuildRole; joined_at: Date | string; xp: number; tokens: number }>(
    `SELECT m.user_id, u.display_name, m.role, m.joined_at, m.xp, m.tokens FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = $1
     ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, m.joined_at`,
    [m.guild_id],
  );
  const requests =
    m.role === 'member'
      ? []
      : await db.query<{ user_id: string; display_name: string; created_at: Date | string }>(
          'SELECT r.user_id, u.display_name, r.created_at FROM guild_join_requests r JOIN users u ON u.id = r.user_id WHERE r.guild_id = $1 ORDER BY r.created_at',
          [m.guild_id],
        );
  const [g] = await db.query<{ xp: number; level: number }>('SELECT xp, level FROM guilds WHERE id = $1', [m.guild_id]);
  const lv = levelFor(g!.xp, config);
  const cardRequests = await db.query<{ id: string; user_id: string; display_name: string; card_id: string; wanted: number; received: number; expires_at: Date | string; owned: number | null }>(
    `SELECT r.id, r.user_id, u.display_name, r.card_id, r.wanted, r.received, r.expires_at, c.quantity AS owned
     FROM guild_card_requests r JOIN users u ON u.id = r.user_id LEFT JOIN collections c ON c.user_id = $3 AND c.card_id = r.card_id
     WHERE r.guild_id = $1 AND r.expires_at > $2 AND r.received < r.wanted ORDER BY r.created_at DESC`,
    [m.guild_id, now, userId],
  );
  const [last] = await db.query<{ created_at: Date | string }>('SELECT created_at FROM guild_card_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
  const nextAt = last ? new Date(new Date(last.created_at).getTime() + config.requests.cooldownHours * 3_600_000) : null;
  const board = await db.query<{ id: string; user_id: string; display_name: string; kind: 'seek' | 'offer'; card_id: string; created_at: Date | string }>(
    `SELECT b.id, b.user_id, u.display_name, b.kind, b.card_id, b.created_at FROM guild_board_posts b JOIN users u ON u.id = b.user_id
     WHERE b.guild_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
    [m.guild_id],
  );
  const guild: GuildDto = {
    ...summary,
    roster: roster.map((r) => ({ userId: r.user_id, name: r.display_name, role: r.role, joinedAt: new Date(r.joined_at).toISOString(), xp: r.xp, you: r.user_id === userId })),
    requests: requests.map((r) => ({ userId: r.user_id, name: r.display_name, at: new Date(r.created_at).toISOString() })),
    you: m.role,
    progress: { xp: g!.xp, levelXp: lv.levelXp, nextXp: lv.nextXp, coinBonus: coinBonusFor(g!.level, config), perks: perksOf(config) },
    tokens: roster.find((r) => r.user_id === userId)?.tokens ?? 0,
    cardRequests: cardRequests.map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.display_name,
      cardId: r.card_id,
      wanted: r.wanted,
      received: r.received,
      expiresAt: new Date(r.expires_at).toISOString(),
      you: r.user_id === userId,
      owned: r.owned ?? 0,
    })),
    nextRequestAt: nextAt && nextAt > now ? nextAt.toISOString() : null,
    board: board.map((b) => ({ id: b.id, userId: b.user_id, name: b.display_name, kind: b.kind, cardId: b.card_id, at: new Date(b.created_at).toISOString(), you: b.user_id === userId })),
    maxBoardPosts: config.maxBoardPosts,
    requestMax: config.requests.maxByRarity,
  };
  return { guild, ...base };
}

// ---------------------------------------------------------------------------
// Niveaux et bonus
// ---------------------------------------------------------------------------

/** Niveau atteint pour une XP totale : passer du niveau n au niveau n + 1 coûte `xpPerLevel × n`. */
export function levelFor(xp: number, config: GuildsConfig): { level: number; levelXp: number; nextXp: number | null } {
  let level = 1;
  let start = 0;
  while (level < config.maxLevel) {
    const cost = config.xpPerLevel * level;
    if (xp < start + cost) return { level, levelXp: start, nextXp: start + cost };
    start += cost;
    level++;
  }
  return { level, levelXp: start, nextXp: null };
}

/** Bonus de pièces de fin de partie (%) au niveau donné. */
export const coinBonusFor = (level: number, config: GuildsConfig) => Math.max(0, ...config.coinBonus.filter((b) => level >= b.level).map((b) => b.pct));

/** Paliers affichés : bonus de pièces et capacité augmentée. */
function perksOf(config: GuildsConfig): { level: number; kind: 'coins' | 'capacity'; value: number }[] {
  const perks = [
    ...config.coinBonus.map((b) => ({ level: b.level, kind: 'coins' as const, value: b.pct })),
    { level: config.capacity.boostLevel, kind: 'capacity' as const, value: config.capacity.boosted },
  ];
  return perks.sort((a, b) => a.level - b.level);
}

/** Bonus de pièces de la guilde d'un joueur (0 sans guilde). */
export async function guildCoinBonus(db: Db, userId: string, config: GuildsConfig): Promise<number> {
  const [g] = await db.query<{ level: number }>('SELECT g.level FROM guilds g JOIN guild_members m ON m.guild_id = g.id WHERE m.user_id = $1', [userId]);
  return g ? coinBonusFor(g.level, config) : 0;
}

/** XP de guilde apportée par un membre (plafonnée par jour) ; met à jour le niveau. Renvoie l'XP ajoutée. */
export async function addGuildXp(db: Db, userId: string, amount: number, config: GuildsConfig, now = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const [m] = await tx.query<{ guild_id: string; xp_day: string | null; xp_today: number }>('SELECT guild_id, xp_day, xp_today FROM guild_members WHERE user_id = $1', [userId]);
    if (!m) return 0;
    const day = now.toISOString().slice(0, 10);
    const used = m.xp_day === day ? m.xp_today : 0;
    const add = Math.min(amount, config.xp.dailyCapPerMember - used);
    if (add <= 0) return 0;
    await tx.query('UPDATE guild_members SET xp = xp + $2, xp_day = $3, xp_today = $4 WHERE user_id = $1', [userId, add, day, used + add]);
    const [g] = await tx.query<{ xp: number }>('UPDATE guilds SET xp = xp + $2 WHERE id = $1 RETURNING xp', [m.guild_id, add]);
    await tx.query('UPDATE guilds SET level = $2 WHERE id = $1 AND level <> $2', [m.guild_id, levelFor(g!.xp, config).level]);
    return add;
  });
}

/** Comme `addGuildXp`, sans jamais faire échouer l'action qui l'a déclenchée. */
export async function addGuildXpSafe(db: Db, userId: string, amount: number, config: GuildsConfig): Promise<void> {
  await addGuildXp(db, userId, amount, config).catch(() => 0);
}

// ---------------------------------------------------------------------------
// Demandes de cartes et dons
// ---------------------------------------------------------------------------

/** Demande de cartes : une à la fois, renouvelable après le délai ; nombre d'exemplaires selon la rareté. */
export async function requestCards(db: Db, userId: string, cardId: string, catalog: CatalogSnapshot, blocked: ReadonlySet<string>, config: GuildsConfig, now = new Date()): Promise<void> {
  const m = await membership(db, userId);
  if (!m) throw new GuildError('not_in_guild', 409);
  const def = [...catalog.collectibles, ...catalog.leaders].find((c) => c.id === cardId);
  if (!def || blocked.has(cardId)) throw new GuildError('unknown_card', 404);
  const wanted = config.requests.maxByRarity[def.rarity] ?? 0;
  if (wanted <= 0) throw new GuildError('not_requestable');
  const [last] = await db.query<{ created_at: Date | string }>('SELECT created_at FROM guild_card_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]);
  if (last && now.getTime() - new Date(last.created_at).getTime() < config.requests.cooldownHours * 3_600_000) throw new GuildError('request_cooldown', 409);
  await db.transaction(async (tx) => {
    // Une seule demande ouverte : la précédente se ferme.
    await tx.query('UPDATE guild_card_requests SET expires_at = $2 WHERE user_id = $1 AND expires_at > $2', [userId, now]);
    await tx.query('INSERT INTO guild_card_requests (id, guild_id, user_id, card_id, wanted, expires_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      randomUUID(),
      m.guild_id,
      userId,
      cardId,
      wanted,
      new Date(now.getTime() + config.requests.expiryHours * 3_600_000),
    ]);
  });
}

/**
 * Don d'un exemplaire à une demande d'un membre de ma guilde. La carte quitte mes decks si besoin (comme un échange).
 * Récompense du donneur : pièces et jetons de guilde selon la rareté, et XP pour la guilde.
 */
export async function donateCard(db: Db, donorId: string, requestId: string, catalog: CatalogSnapshot, config: GuildsConfig, now = new Date()): Promise<{ coins: number; tokens: number }> {
  const reward = await db.transaction(async (tx) => {
    const [req] = await tx.query<{ guild_id: string; user_id: string; card_id: string; wanted: number; received: number; expires_at: Date | string }>(
      'SELECT guild_id, user_id, card_id, wanted, received, expires_at FROM guild_card_requests WHERE id = $1',
      [requestId],
    );
    if (!req) throw new GuildError('request_not_found', 404);
    const m = await membership(tx, donorId);
    if (!m || m.guild_id !== req.guild_id) throw new GuildError('forbidden', 403);
    if (req.user_id === donorId) throw new GuildError('self');
    if (new Date(req.expires_at) <= now || req.received >= req.wanted) throw new GuildError('request_closed', 409);
    const def = [...catalog.collectibles, ...catalog.leaders].find((c) => c.id === req.card_id);
    if (!def) throw new GuildError('unknown_card', 404);

    const taken = await tx.query('UPDATE collections SET quantity = quantity - 1 WHERE user_id = $1 AND card_id = $2 AND quantity >= 1 RETURNING quantity', [donorId, req.card_id]);
    if (taken.length === 0) throw new GuildError('not_owned', 409);
    await tx.query('DELETE FROM collections WHERE user_id = $1 AND card_id = $2 AND quantity <= 0', [donorId, req.card_id]);
    await tx.query(
      `INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, 1)
       ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = collections.quantity + 1`,
      [req.user_id, req.card_id],
    );
    for (const [user, amount] of [
      [donorId, -1],
      [req.user_id, 1],
    ] as const) {
      await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'cards', $2, 'guild_donation', $3)", [user, amount, `${requestId}:${req.card_id}`]);
    }
    await trimDecks(tx, donorId, [req.card_id]);
    await tx.query('UPDATE guild_card_requests SET received = received + 1 WHERE id = $1', [requestId]);
    await tx.query('INSERT INTO guild_card_donations (request_id, donor_id) VALUES ($1, $2)', [requestId, donorId]);

    const coins = config.requests.donorCoins[def.rarity] ?? 0;
    const tokens = config.requests.donorTokens[def.rarity] ?? 0;
    await tx.query('UPDATE wallets SET coins = coins + $2 WHERE user_id = $1', [donorId, coins]);
    if (coins) await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'guild_donation', $3)", [donorId, coins, requestId]);
    await tx.query('UPDATE guild_members SET tokens = tokens + $2 WHERE user_id = $1', [donorId, tokens]);
    return { coins, tokens };
  });
  await addGuildXpSafe(db, donorId, config.xp.donation, config);
  return reward;
}

// ---------------------------------------------------------------------------
// Tableau d'échanges
// ---------------------------------------------------------------------------

export async function postOnBoard(db: Db, userId: string, kind: 'seek' | 'offer', cardId: string, catalog: CatalogSnapshot, config: GuildsConfig): Promise<void> {
  const m = await membership(db, userId);
  if (!m) throw new GuildError('not_in_guild', 409);
  if (![...catalog.collectibles, ...catalog.leaders].some((c) => c.id === cardId)) throw new GuildError('unknown_card', 404);
  const [n] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM guild_board_posts WHERE user_id = $1', [userId]);
  if ((n?.n ?? 0) >= config.maxBoardPosts) throw new GuildError('board_full', 409);
  await db.query('INSERT INTO guild_board_posts (id, guild_id, user_id, kind, card_id) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), m.guild_id, userId, kind, cardId]);
}

/** Retirer une annonce : la sienne, ou n'importe laquelle pour le chef et les adjoints. */
export async function removeBoardPost(db: Db, userId: string, postId: string): Promise<void> {
  const m = await membership(db, userId);
  if (!m) throw new GuildError('not_in_guild', 409);
  const [post] = await db.query<{ user_id: string; guild_id: string }>('SELECT user_id, guild_id FROM guild_board_posts WHERE id = $1', [postId]);
  if (!post || post.guild_id !== m.guild_id) throw new GuildError('post_not_found', 404);
  if (post.user_id !== userId && m.role === 'member') throw new GuildError('forbidden', 403);
  await db.query('DELETE FROM guild_board_posts WHERE id = $1', [postId]);
}

/** Un membre qui quitte la guilde emporte ses demandes de cartes et ses annonces. */
async function clearMemberActivity(tx: Db, userId: string, guildId: string): Promise<void> {
  await tx.query('DELETE FROM guild_board_posts WHERE user_id = $1 AND guild_id = $2', [userId, guildId]);
  await tx.query('UPDATE guild_card_requests SET expires_at = now() WHERE user_id = $1 AND guild_id = $2 AND expires_at > now()', [userId, guildId]);
}

/** Ajoute un membre si la guilde a de la place (dans la transaction de l'appelant). */
async function addMember(tx: Db, guildId: string, userId: string, config: GuildsConfig): Promise<void> {
  const [g] = await tx.query<{ level: number; members: number }>('SELECT level, (SELECT count(*)::int FROM guild_members WHERE guild_id = $1) AS members FROM guilds WHERE id = $1', [guildId]);
  if (!g) throw new GuildError('guild_not_found', 404);
  if (g.members >= guildCapacity(g.level, config)) throw new GuildError('guild_full', 409);
  const added = await tx.query("INSERT INTO guild_members (guild_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id) DO NOTHING RETURNING 1", [guildId, userId]);
  if (added.length === 0) throw new GuildError('already_in_guild', 409);
  await tx.query('DELETE FROM guild_join_requests WHERE user_id = $1', [userId]);
}

/** Rejoindre : tout de suite si la guilde est ouverte, sinon demande au chef et aux adjoints. */
export async function joinGuild(db: Db, userId: string, guildId: string, config: GuildsConfig): Promise<'joined' | 'requested'> {
  if (await membership(db, userId)) throw new GuildError('already_in_guild', 409);
  const [g] = await db.query<{ open: boolean }>('SELECT open FROM guilds WHERE id = $1', [guildId]);
  if (!g) throw new GuildError('guild_not_found', 404);
  if (g.open) {
    await db.transaction((tx) => addMember(tx, guildId, userId, config));
    return 'joined';
  }
  const [n] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM guild_join_requests WHERE user_id = $1', [userId]);
  if ((n?.n ?? 0) >= config.maxPendingRequests) throw new GuildError('too_many_guild_requests', 409);
  await db.query('INSERT INTO guild_join_requests (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guildId, userId]);
  return 'requested';
}

export async function cancelJoinRequest(db: Db, userId: string, guildId: string): Promise<void> {
  await db.query('DELETE FROM guild_join_requests WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
}

/** Chef ou adjoint : accepter ou refuser une demande. */
export async function decideRequest(db: Db, userId: string, applicantId: string, accept: boolean, config: GuildsConfig): Promise<void> {
  const m = await membership(db, userId);
  if (!m || m.role === 'member') throw new GuildError('forbidden', 403);
  const [req] = await db.query('SELECT 1 FROM guild_join_requests WHERE guild_id = $1 AND user_id = $2', [m.guild_id, applicantId]);
  if (!req) throw new GuildError('request_not_found', 404);
  const [g] = await db.query<{ name: string }>('SELECT name FROM guilds WHERE id = $1', [m.guild_id]);
  if (!accept) {
    await db.query('DELETE FROM guild_join_requests WHERE guild_id = $1 AND user_id = $2', [m.guild_id, applicantId]);
    return;
  }
  await db.transaction(async (tx) => {
    await addMember(tx, m.guild_id, applicantId, config);
    await notify(tx, applicantId, 'guild_joined', { guild: g!.name });
  });
}

/** Quitter : le chef passe la main (plus ancien adjoint, sinon plus ancien membre) ; une guilde vide est dissoute. */
export async function leaveGuild(db: Db, userId: string): Promise<void> {
  const m = await membership(db, userId);
  if (!m) throw new GuildError('not_in_guild', 409);
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM guild_members WHERE user_id = $1', [userId]);
    await clearMemberActivity(tx, userId, m.guild_id);
    const [heir] = await tx.query<{ user_id: string }>(
      "SELECT user_id FROM guild_members WHERE guild_id = $1 ORDER BY CASE role WHEN 'officer' THEN 0 ELSE 1 END, joined_at LIMIT 1",
      [m.guild_id],
    );
    if (!heir) {
      await tx.query('DELETE FROM guilds WHERE id = $1', [m.guild_id]);
      return;
    }
    if (m.role === 'leader') {
      await tx.query("UPDATE guild_members SET role = 'leader' WHERE user_id = $1", [heir.user_id]);
      const [g] = await tx.query<{ name: string }>('SELECT name FROM guilds WHERE id = $1', [m.guild_id]);
      await notify(tx, heir.user_id, 'guild_role', { guild: g!.name, role: 'leader' });
    }
  });
}

/** Exclure : le chef exclut n'importe qui, un adjoint seulement les simples membres. */
export async function kickMember(db: Db, userId: string, targetId: string): Promise<void> {
  const m = await membership(db, userId);
  const target = await membership(db, targetId);
  if (!m || !target || target.guild_id !== m.guild_id || targetId === userId) throw new GuildError('forbidden', 403);
  const allowed = m.role === 'leader' || (m.role === 'officer' && target.role === 'member');
  if (!allowed) throw new GuildError('forbidden', 403);
  const [g] = await db.query<{ name: string }>('SELECT name FROM guilds WHERE id = $1', [m.guild_id]);
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM guild_members WHERE user_id = $1 AND guild_id = $2', [targetId, m.guild_id]);
    await clearMemberActivity(tx, targetId, m.guild_id);
    await notify(tx, targetId, 'guild_kicked', { guild: g!.name });
  });
}

/** Chef seulement : nommer adjoint, rétrograder, ou passer la main (il devient adjoint). */
export async function setRole(db: Db, userId: string, targetId: string, role: GuildRole): Promise<void> {
  const m = await membership(db, userId);
  const target = await membership(db, targetId);
  if (!m || m.role !== 'leader' || !target || target.guild_id !== m.guild_id || targetId === userId) throw new GuildError('forbidden', 403);
  const [g] = await db.query<{ name: string }>('SELECT name FROM guilds WHERE id = $1', [m.guild_id]);
  await db.transaction(async (tx) => {
    if (role === 'leader') await tx.query("UPDATE guild_members SET role = 'officer' WHERE user_id = $1", [userId]);
    await tx.query('UPDATE guild_members SET role = $2 WHERE user_id = $1', [targetId, role]);
    await notify(tx, targetId, 'guild_role', { guild: g!.name, role });
  });
}

/** Chef seulement : description, emblème, langue, entrée libre ou sur demande. */
export async function updateGuild(db: Db, userId: string, settings: GuildSettings, config: GuildsConfig): Promise<void> {
  checkSettings(settings, config);
  const m = await membership(db, userId);
  if (!m || m.role !== 'leader') throw new GuildError('forbidden', 403);
  await db.query('UPDATE guilds SET description = $2, emblem = $3, language = $4, open = $5 WHERE id = $1', [
    m.guild_id,
    settings.description.trim(),
    settings.emblem,
    settings.language,
    settings.open,
  ]);
}

/** Membres de la même guilde (échanges et amicaux entre membres, étapes suivantes). */
export async function sameGuild(db: Db, a: string, b: string): Promise<boolean> {
  const [row] = await db.query('SELECT 1 FROM guild_members x JOIN guild_members y ON x.guild_id = y.guild_id WHERE x.user_id = $1 AND y.user_id = $2', [a, b]);
  return !!row;
}
