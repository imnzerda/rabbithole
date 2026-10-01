import { randomBytes } from 'node:crypto';
import { RARITIES, Rng, type CardDef, type Rarity } from '@rabbithole/engine';
import { LEADER_CARDS, COLLECTIBLE_CARDS } from '@rabbithole/content';
import type { EconomyConfig } from '../config.js';
import { ctx } from '../content.js';
import type { Db } from '../db/db.js';

export class EconomyError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}

/** Types de boosters du prototype (section 6.2) : un seul pour l'instant, le booster de base. */
export const BOOSTER_TYPES = {
  base: { name: { fr: 'Booster de base', en: 'Base booster' }, pool: [...COLLECTIBLE_CARDS, ...LEADER_CARDS] },
} as const satisfies Record<string, { name: Record<string, string>; pool: CardDef[] }>;
export type BoosterType = keyof typeof BOOSTER_TYPES;

export const isBoosterType = (t: string): t is BoosterType => t in BOOSTER_TYPES;

function byRarity(pool: readonly CardDef[]): Map<Rarity, CardDef[]> {
  const map = new Map<Rarity, CardDef[]>();
  for (const c of pool) map.set(c.rarity, [...(map.get(c.rarity) ?? []), c]);
  return map;
}

/** Probabilités affichées (transparence, section 14) : chance de chaque rareté pour chaque carte. */
export function boosterOdds(type: BoosterType, economy: EconomyConfig): Record<string, number> {
  const groups = byRarity(BOOSTER_TYPES[type].pool);
  const present = RARITIES.filter((r) => groups.has(r));
  const total = present.reduce((sum, r) => sum + economy.rarityWeights[r], 0);
  return Object.fromEntries(present.map((r) => [r, Math.round((economy.rarityWeights[r] / total) * 10000) / 100]));
}

/** Contenu d'un booster, déterminé par sa seed (tirée par le RNG cryptographique du serveur, et enregistrée). */
export function generateBooster(type: BoosterType, seed: string, economy: EconomyConfig): string[] {
  const rng = Rng.fromSeed(seed);
  const groups = byRarity(BOOSTER_TYPES[type].pool);
  const rarities = RARITIES.filter((r) => groups.has(r));
  const weights = rarities.map((r) => economy.rarityWeights[r]);
  return Array.from({ length: economy.boosterSize }, () => rng.pick(groups.get(rarities[rng.weighted(weights)]!)!).id);
}

const newSeed = () => randomBytes(16).toString('hex');

/** Exemplaires gardés : 1 Leader suffit ; sinon `keepCopies` (le maximum jouable dans un deck). */
const keepFor = (def: CardDef, economy: EconomyConfig) => (def.type === 'leader' ? 1 : economy.keepCopies);

export interface Wallet {
  coins: number;
  gems: number;
  essence: number;
  freeBoosters: number;
}

export async function getWallet(db: Db, userId: string): Promise<Wallet> {
  const [w] = await db.query<{ coins: number; gems: number; essence: number; free_boosters: number }>(
    'SELECT coins, gems, essence, free_boosters FROM wallets WHERE user_id = $1',
    [userId],
  );
  return { coins: w?.coins ?? 0, gems: w?.gems ?? 0, essence: w?.essence ?? 0, freeBoosters: w?.free_boosters ?? 0 };
}

async function ledger(db: Db, userId: string, currency: string, amount: number, reason: string, ref: string | null = null): Promise<void> {
  await db.query('INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, $2, $3, $4, $5)', [userId, currency, amount, reason, ref]);
}

export async function addCards(db: Db, userId: string, cardIds: string[]): Promise<void> {
  for (const id of cardIds) {
    await db.query(
      `INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, 1)
       ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = collections.quantity + 1`,
      [userId, id],
    );
  }
}

export interface Preview {
  cardIds: string[];
  refreshAt: string;
}

const iso = (d: string | Date) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

/**
 * Aperçu du prochain booster : exactement les cartes que l'acheteur recevra, verrouillées en base.
 * Il ne se renouvelle qu'après un achat ou à l'expiration du délai. Aucun moyen payant de le renouveler.
 */
export async function ensurePreview(db: Db, userId: string, type: BoosterType, economy: EconomyConfig): Promise<Preview> {
  const [row] = await db.query<{ card_ids: string[]; refresh_at: string | Date; expired: boolean }>(
    'SELECT card_ids, refresh_at, refresh_at <= now() AS expired FROM booster_previews WHERE user_id = $1 AND booster_type = $2',
    [userId, type],
  );
  if (row && !row.expired) return { cardIds: row.card_ids, refreshAt: iso(row.refresh_at) };
  return regeneratePreview(db, userId, type, economy);
}

async function regeneratePreview(db: Db, userId: string, type: BoosterType, economy: EconomyConfig): Promise<Preview> {
  const seed = newSeed();
  const cardIds = generateBooster(type, seed, economy);
  const [row] = await db.query<{ refresh_at: string | Date }>(
    `INSERT INTO booster_previews (user_id, booster_type, card_ids, seed, refresh_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))
     ON CONFLICT (user_id, booster_type) DO UPDATE
       SET card_ids = EXCLUDED.card_ids, seed = EXCLUDED.seed, generated_at = now(), refresh_at = EXCLUDED.refresh_at
     RETURNING refresh_at`,
    [userId, type, cardIds, seed, economy.previewRefreshHours],
  );
  return { cardIds, refreshAt: iso(row!.refresh_at) };
}

/**
 * Achat de l'aperçu en pièces. Le client envoie les cartes qu'il a vues : si l'aperçu a changé
 * entre-temps (expiration), l'achat est refusé — on ne vend jamais un contenu non montré.
 */
export async function purchasePreview(
  db: Db,
  userId: string,
  type: BoosterType,
  expected: string[],
  economy: EconomyConfig,
): Promise<{ cards: string[]; next: Preview }> {
  return db.transaction(async (tx) => {
    const current = await ensurePreview(tx, userId, type, economy);
    if (current.cardIds.length !== expected.length || current.cardIds.some((id, i) => id !== expected[i])) {
      throw new EconomyError('preview_changed', 409);
    }
    const paid = await tx.query('UPDATE wallets SET coins = coins - $2 WHERE user_id = $1 AND coins >= $2 RETURNING coins', [userId, economy.boosterPrice]);
    if (paid.length === 0) throw new EconomyError('not_enough_coins', 402);
    const [seed] = await tx.query<{ seed: string }>('SELECT seed FROM booster_previews WHERE user_id = $1 AND booster_type = $2', [userId, type]);
    await addCards(tx, userId, current.cardIds);
    await ledger(tx, userId, 'coins', -economy.boosterPrice, 'booster_purchase', type);
    await tx.query(`INSERT INTO booster_openings (user_id, booster_type, source, price, card_ids, seed) VALUES ($1, $2, 'purchase', $3, $4, $5)`, [
      userId,
      type,
      economy.boosterPrice,
      current.cardIds,
      seed?.seed ?? '',
    ]);
    // Après un achat, un nouvel aperçu est généré immédiatement.
    const next = await regeneratePreview(tx, userId, type, economy);
    return { cards: current.cardIds, next };
  });
}

/** Booster gratuit (récompense) : contenu aléatoire autorisé, puisqu'aucune somme n'est engagée. */
export async function openFreeBooster(db: Db, userId: string, type: BoosterType, economy: EconomyConfig): Promise<string[]> {
  return db.transaction(async (tx) => {
    const used = await tx.query('UPDATE wallets SET free_boosters = free_boosters - 1 WHERE user_id = $1 AND free_boosters > 0 RETURNING free_boosters', [userId]);
    if (used.length === 0) throw new EconomyError('no_free_booster', 402);
    const seed = newSeed();
    const cards = generateBooster(type, seed, economy);
    await addCards(tx, userId, cards);
    await ledger(tx, userId, 'free_boosters', -1, 'booster_open', type);
    await tx.query(`INSERT INTO booster_openings (user_id, booster_type, source, card_ids, seed) VALUES ($1, $2, 'free', $3, $4)`, [userId, type, cards, seed]);
    return cards;
  });
}

function collectible(cardId: string): CardDef {
  const def = ctx.cards[cardId];
  if (!def || def.series !== 'prototype') throw new EconomyError('unknown_card', 404);
  return def;
}

/** Recyclage des doublons en essence : on garde toujours les exemplaires jouables. */
export async function recycle(db: Db, userId: string, cardId: string, count: number, economy: EconomyConfig): Promise<Wallet> {
  const def = collectible(cardId);
  return db.transaction(async (tx) => {
    const keep = keepFor(def, economy);
    const done = await tx.query('UPDATE collections SET quantity = quantity - $3 WHERE user_id = $1 AND card_id = $2 AND quantity - $3 >= $4 RETURNING quantity', [
      userId,
      cardId,
      count,
      keep,
    ]);
    if (done.length === 0) throw new EconomyError('not_enough_duplicates');
    const gain = economy.recycle[def.rarity] * count;
    await tx.query('UPDATE wallets SET essence = essence + $2 WHERE user_id = $1', [userId, gain]);
    await ledger(tx, userId, 'essence', gain, 'recycle', cardId);
    return getWallet(tx, userId);
  });
}

/** Fabrication d'une carte avec l'essence, jusqu'au nombre d'exemplaires jouables. */
export async function craft(db: Db, userId: string, cardId: string, economy: EconomyConfig): Promise<Wallet> {
  const def = collectible(cardId);
  return db.transaction(async (tx) => {
    const [owned] = await tx.query<{ quantity: number }>('SELECT quantity FROM collections WHERE user_id = $1 AND card_id = $2', [userId, cardId]);
    if ((owned?.quantity ?? 0) >= keepFor(def, economy)) throw new EconomyError('already_complete');
    const cost = economy.craft[def.rarity];
    const paid = await tx.query('UPDATE wallets SET essence = essence - $2 WHERE user_id = $1 AND essence >= $2 RETURNING essence', [userId, cost]);
    if (paid.length === 0) throw new EconomyError('not_enough_essence', 402);
    await addCards(tx, userId, [cardId]);
    await ledger(tx, userId, 'essence', -cost, 'craft', cardId);
    return getWallet(tx, userId);
  });
}

/** Leader de départ : choisi une seule fois (sans Leader, aucun deck n'est possible). */
export async function chooseStarterLeader(db: Db, userId: string, leaderId: string): Promise<void> {
  const def = ctx.cards[leaderId];
  if (!def || def.type !== 'leader' || def.series !== 'prototype') throw new EconomyError('not_a_leader');
  await db.transaction(async (tx) => {
    const set = await tx.query('UPDATE users SET starter_leader = $2 WHERE id = $1 AND starter_leader IS NULL RETURNING id', [userId, leaderId]);
    if (set.length === 0) throw new EconomyError('already_chosen', 409);
    await addCards(tx, userId, [leaderId]);
    await ledger(tx, userId, 'cards', 1, 'starter_leader', leaderId);
  });
}

/** Pièces de fin de partie, dans la limite d'un plafond journalier (anti-farm). Renvoie le montant crédité. */
export async function awardMatchCoins(db: Db, userId: string, amount: number, matchId: string, economy: EconomyConfig): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx.query<{ total: number }>(
      `SELECT coalesce(sum(amount), 0)::int AS total FROM coin_ledger
       WHERE user_id = $1 AND reason = 'match' AND created_at > now() - interval '1 day'`,
      [userId],
    );
    const granted = Math.max(0, Math.min(amount, economy.rewards.dailyCap - (row?.total ?? 0)));
    if (granted > 0) {
      await tx.query('UPDATE wallets SET coins = coins + $2 WHERE user_id = $1', [userId, granted]);
      await ledger(tx, userId, 'coins', granted, 'match', matchId);
    }
    return granted;
  });
}
