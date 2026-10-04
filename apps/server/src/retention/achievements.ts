import { CATEGORIES, CATEGORY_NAMES, type CategoryId } from '@rabbithole/engine';
import type { AchievementDto, AchievementsDto } from '@rabbithole/shared';
import type { CatalogSnapshot } from '../catalog/catalog.js';
import type { AchievementDef, AchievementMetric, AchievementsConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { EconomyError } from '../economy/economy.js';

/**
 * Succès et progression de collection (section 13). Tout est calculé à partir des données du joueur
 * (parties, collection, boosters, trade-up, échanges, amis, classé) : rien à compter à part. Seules les
 * réclamations sont enregistrées ; une récompense ne se réclame qu'une fois.
 */

type Metrics = Record<AchievementMetric, number> & { categories: Record<CategoryId, { owned: number; total: number }> };

async function count(db: Db, sql: string, params: unknown[]): Promise<number> {
  const [row] = await db.query<{ n: number }>(sql, params);
  return Number(row?.n ?? 0);
}

async function metrics(db: Db, userId: string, catalog: CatalogSnapshot): Promise<Metrics> {
  const cards = [...catalog.collectibles, ...catalog.leaders];
  const owned = new Set(
    (await db.query<{ card_id: string }>('SELECT card_id FROM collections WHERE user_id = $1 AND quantity > 0', [userId])).map((r) => r.card_id),
  );
  const mine = cards.filter((c) => owned.has(c.id));
  const categories = Object.fromEntries(
    CATEGORIES.map((cat) => {
      const of = cards.filter((c) => c.categories.includes(cat));
      return [cat, { owned: of.filter((c) => owned.has(c.id)).length, total: of.length }];
    }),
  ) as Metrics['categories'];
  const ended = `ended_at IS NOT NULL AND result IS NOT NULL`;
  return {
    games: await count(db, `SELECT count(*)::int AS n FROM matches WHERE ${ended} AND (player_a = $1 OR player_b = $1)`, [userId]),
    wins: await count(db, `SELECT count(*)::int AS n FROM matches WHERE ${ended} AND ((player_a = $1 AND result->>'winner' = '0') OR (player_b = $1 AND result->>'winner' = '1'))`, [userId]),
    ranked_wins: await count(
      db,
      `SELECT count(*)::int AS n FROM matches WHERE ${ended} AND mode = 'ranked' AND ((player_a = $1 AND result->>'winner' = '0') OR (player_b = $1 AND result->>'winner' = '1'))`,
      [userId],
    ),
    best_rank_points: await count(db, 'SELECT coalesce(max(best_points), 0)::int AS n FROM ranked WHERE user_id = $1', [userId]),
    cards: mine.length,
    goats: mine.filter((c) => c.rarity === 'goat').length,
    boosters: await count(db, 'SELECT count(*)::int AS n FROM booster_openings WHERE user_id = $1', [userId]),
    trade_ups: await count(db, 'SELECT count(*)::int AS n FROM trade_ups WHERE user_id = $1', [userId]),
    trades: await count(db, "SELECT count(*)::int AS n FROM trades WHERE status = 'accepted' AND (from_user = $1 OR to_user = $1)", [userId]),
    friends: await count(db, 'SELECT count(*)::int AS n FROM friendships WHERE accepted_at IS NOT NULL AND (requester_id = $1 OR addressee_id = $1)', [userId]),
    categories,
  };
}

/** Tous les succès : ceux de la config, plus un « Spécialiste » par catégorie (toutes ses cartes possédées). */
function definitions(config: AchievementsConfig, m: Metrics): (AchievementDef & { category?: CategoryId; value: number })[] {
  const listed = config.list.map((d) => ({ ...d, value: m[d.metric] }));
  const specialists = CATEGORIES.filter((cat) => m.categories[cat].total > 0).map((cat) => ({
    id: `specialist_${cat}`,
    metric: 'cards' as const,
    target: m.categories[cat].total,
    coins: config.specialist.coins,
    title: { fr: `Spécialiste ${CATEGORY_NAMES[cat].fr}`, en: `${CATEGORY_NAMES[cat].en} specialist` },
    category: cat,
    value: m.categories[cat].owned,
  }));
  return [...listed, ...specialists];
}

function collectionProgress(m: Metrics, claimed: number, config: AchievementsConfig): AchievementsDto['collection'] {
  const c = config.collection;
  const points = m.cards * c.pointsPerCard + m.games * c.pointsPerGame;
  const level = Math.floor(points / c.pointsPerLevel);
  return { points, level, pointsPerLevel: c.pointsPerLevel, claimable: Math.max(0, level - claimed), reward: c.reward };
}

export async function listAchievements(db: Db, userId: string, config: AchievementsConfig, catalog: CatalogSnapshot): Promise<AchievementsDto> {
  const m = await metrics(db, userId, catalog);
  const claimed = new Set((await db.query<{ achievement_id: string }>('SELECT achievement_id FROM user_achievements WHERE user_id = $1', [userId])).map((r) => r.achievement_id));
  const [user] = await db.query<{ collection_level_claimed: number }>('SELECT collection_level_claimed FROM users WHERE id = $1', [userId]);
  const achievements: AchievementDto[] = definitions(config, m).map((d) => ({
    id: d.id,
    metric: d.metric,
    category: d.category ?? null,
    target: d.target,
    progress: Math.min(d.value, d.target),
    coins: d.coins,
    title: d.title ?? null,
    unlocked: d.value >= d.target,
    claimed: claimed.has(d.id),
  }));
  return { collection: collectionProgress(m, user?.collection_level_claimed ?? 0, config), achievements };
}

/** Réclamer un succès atteint : pièces, et titre pour les plus durs. Une seule fois. */
export async function claimAchievement(db: Db, userId: string, id: string, config: AchievementsConfig, catalog: CatalogSnapshot): Promise<{ coins: number; title: Record<string, string> | null }> {
  const def = definitions(config, await metrics(db, userId, catalog)).find((d) => d.id === id);
  if (!def) throw new EconomyError('unknown_achievement', 404);
  if (def.value < def.target) throw new EconomyError('achievement_locked', 409);
  return db.transaction(async (tx) => {
    const fresh = await tx.query('INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [userId, id]);
    if (fresh.length === 0) throw new EconomyError('already_claimed', 409);
    if (def.coins > 0) {
      await tx.query('UPDATE wallets SET coins = coins + $2 WHERE user_id = $1', [userId, def.coins]);
      await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'achievement', $3)", [userId, def.coins, id]);
    }
    if (def.title) {
      await tx.query('INSERT INTO user_titles (user_id, title_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, `achievement_${id}`, JSON.stringify(def.title)]);
    }
    return { coins: def.coins, title: def.title ?? null };
  });
}

/** Réclamer tous les niveaux atteints de la progression de collection. */
export async function claimCollectionLevels(db: Db, userId: string, config: AchievementsConfig, catalog: CatalogSnapshot): Promise<{ levels: number; coins: number; freeBoosters: number }> {
  const m = await metrics(db, userId, catalog);
  return db.transaction(async (tx) => {
    const [user] = await tx.query<{ collection_level_claimed: number }>('SELECT collection_level_claimed FROM users WHERE id = $1', [userId]);
    const progress = collectionProgress(m, user?.collection_level_claimed ?? 0, config);
    if (progress.claimable === 0) throw new EconomyError('nothing_to_claim', 409);
    const n = progress.claimable;
    const coins = n * config.collection.reward.coins;
    const freeBoosters = n * config.collection.reward.freeBoosters;
    // Garde-fou contre deux réclamations simultanées : le niveau réclamé ne fait qu'augmenter.
    const done = await tx.query('UPDATE users SET collection_level_claimed = $2 WHERE id = $1 AND collection_level_claimed = $3 RETURNING 1', [
      userId,
      progress.level,
      user?.collection_level_claimed ?? 0,
    ]);
    if (done.length === 0) throw new EconomyError('nothing_to_claim', 409);
    await tx.query('UPDATE wallets SET coins = coins + $2, free_boosters = free_boosters + $3 WHERE user_id = $1', [userId, coins, freeBoosters]);
    await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'collection_level', $3)", [userId, coins, String(progress.level)]);
    if (freeBoosters) {
      await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'free_boosters', $2, 'collection_level', $3)", [userId, freeBoosters, String(progress.level)]);
    }
    return { levels: n, coins, freeBoosters };
  });
}
