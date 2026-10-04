import type { LeaderboardEntryDto, RankedDto, RankedResultDto } from '@rabbithole/shared';
import type { RankedConfig } from '../config.js';
import type { Db } from '../db/db.js';

/**
 * Classé (section 7). Saisons mensuelles (mois UTC, clé 'AAAA-MM'). Points de classement : victoire,
 * défaite, nul (config), multipliés par l'enjeu de la partie (Hype ×1, ×2, ×4, section 3.4) ; une défaite
 * ne fait jamais redescendre sous le seuil du rang atteint.
 * Nouvelle saison : la ligne est créée à la première visite ou partie, avec une part des points de la
 * saison précédente (reset partiel), et la récompense du meilleur rang passé est versée (pièces, titre).
 */

export function seasonOf(now = new Date()): { key: string; endsAt: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, endsAt: new Date(Date.UTC(y, m + 1, 1)) };
}

export function rankOf(points: number, config: RankedConfig): RankedConfig['ranks'][number] {
  let rank = config.ranks[0]!;
  for (const r of config.ranks) if (points >= r.min) rank = r;
  return rank;
}

interface Row {
  points: number;
  best_points: number;
  wins: number;
  losses: number;
  draws: number;
}

const RANK_NAMES: Record<string, { fr: string; en: string }> = {
  lurker: { fr: 'Lurker', en: 'Lurker' },
  normie: { fr: 'Normie', en: 'Normie' },
  posteur: { fr: 'Posteur', en: 'Poster' },
  influenceur: { fr: 'Influenceur', en: 'Influencer' },
  viral: { fr: 'Viral', en: 'Viral' },
  legende: { fr: 'Légende', en: 'Legend' },
};

/** Récompense du meilleur rang d'une saison passée : pièces, titre pour les rangs les plus hauts, notification. */
async function rewardSeason(db: Db, userId: string, season: string, bestPoints: number, config: RankedConfig): Promise<void> {
  const rank = rankOf(bestPoints, config);
  const name = RANK_NAMES[rank.id] ?? { fr: rank.id, en: rank.id };
  if (rank.reward.coins > 0) {
    await db.query('UPDATE wallets SET coins = coins + $2 WHERE user_id = $1', [userId, rank.reward.coins]);
    await db.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'ranked_season', $3)", [userId, rank.reward.coins, season]);
  }
  const title = rank.reward.title ? { fr: `${name.fr} · classé ${season}`, en: `${name.en} · ranked ${season}` } : null;
  if (title) {
    await db.query('INSERT INTO user_titles (user_id, title_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, `ranked_${season}_${rank.id}`, JSON.stringify(title)]);
  }
  if (rank.reward.coins > 0 || title) {
    await db.query("INSERT INTO notices (user_id, kind, payload) VALUES ($1, 'ranked_season', $2)", [userId, JSON.stringify({ season, rank: rank.id, coins: rank.reward.coins, title })]);
  }
  await db.query('UPDATE ranked SET rewarded = true WHERE user_id = $1 AND season = $2', [userId, season]);
}

/** Ligne de la saison en cours : reset partiel depuis la dernière saison jouée, récompense de celle-ci. */
async function ensure(db: Db, userId: string, config: RankedConfig, now: Date): Promise<Row> {
  const { key } = seasonOf(now);
  const [current] = await db.query<Row>('SELECT points, best_points, wins, losses, draws FROM ranked WHERE user_id = $1 AND season = $2', [userId, key]);
  if (current) return current;
  return db.transaction(async (tx) => {
    const [previous] = await tx.query<{ season: string; points: number; best_points: number; rewarded: boolean }>(
      'SELECT season, points, best_points, rewarded FROM ranked WHERE user_id = $1 AND season < $2 ORDER BY season DESC LIMIT 1',
      [userId, key],
    );
    if (previous && !previous.rewarded) await rewardSeason(tx, userId, previous.season, previous.best_points, config);
    const points = previous ? Math.round(previous.points * config.carry) : 0;
    await tx.query('INSERT INTO ranked (user_id, season, points, best_points) VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING', [userId, key, points]);
    const [row] = await tx.query<Row>('SELECT points, best_points, wins, losses, draws FROM ranked WHERE user_id = $1 AND season = $2', [userId, key]);
    return row!;
  });
}

/** Résultat d'une partie classée pour un joueur ; `stake` : enjeu final de la partie (Hype). */
export async function applyRankedResult(
  db: Db,
  userId: string,
  outcome: 'win' | 'loss' | 'draw',
  stake: number,
  config: RankedConfig,
  now = new Date(),
): Promise<RankedResultDto> {
  const row = await ensure(db, userId, config, now);
  const before = row.points;
  const rankBefore = rankOf(before, config);
  const raw = outcome === 'win' ? before + config.win * stake : outcome === 'draw' ? before + config.draw : before - config.loss * stake;
  // Protection de rang : une défaite ne fait pas descendre sous le seuil du rang atteint.
  const after = Math.max(rankBefore.min, raw);
  await db.query(
    `UPDATE ranked SET points = $3, best_points = GREATEST(best_points, $3),
       wins = wins + $4, losses = losses + $5, draws = draws + $6, updated_at = now()
     WHERE user_id = $1 AND season = $2`,
    [userId, seasonOf(now).key, after, outcome === 'win' ? 1 : 0, outcome === 'loss' ? 1 : 0, outcome === 'draw' ? 1 : 0],
  );
  return { before, after, delta: after - before, rankBefore: rankBefore.id, rank: rankOf(after, config).id };
}

/** Position : 1 + nombre de joueurs devant (plus de points, ou autant mais arrivés avant). */
async function positionOf(db: Db, userId: string, season: string, country: string | null): Promise<number | null> {
  const [me] = await db.query<{ points: number; updated_at: string | Date; games: number }>(
    'SELECT points, updated_at, wins + losses + draws AS games FROM ranked WHERE user_id = $1 AND season = $2',
    [userId, season],
  );
  if (!me || me.games === 0) return null;
  const [row] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ranked r JOIN users u ON u.id = r.user_id
     WHERE r.season = $1 AND r.wins + r.losses + r.draws > 0 AND ($4::text IS NULL OR u.country = $4)
       AND (r.points > $2 OR (r.points = $2 AND r.updated_at < $3))`,
    [season, me.points, me.updated_at, country],
  );
  return (row?.n ?? 0) + 1;
}

export async function getRanked(db: Db, user: { id: string; country: string }, config: RankedConfig, now = new Date()): Promise<RankedDto> {
  const row = await ensure(db, user.id, config, now);
  const season = seasonOf(now);
  const rank = rankOf(row.points, config);
  const next = config.ranks.find((r) => r.min > row.points) ?? null;
  return {
    season: season.key,
    endsAt: season.endsAt.toISOString(),
    points: row.points,
    bestPoints: row.best_points,
    rank: rank.id,
    rankMin: rank.min,
    next: next ? { rank: next.id, min: next.min } : null,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    position: await positionOf(db, user.id, season.key, null),
    countryPosition: await positionOf(db, user.id, season.key, user.country),
    country: user.country,
    ranks: config.ranks.map((r) => ({ id: r.id, min: r.min })),
  };
}

/** Classement de la saison (top N), mondial ou d'un pays ; seuls les joueurs ayant joué en classé y figurent. */
export async function leaderboard(db: Db, viewerId: string, country: string | null, limit: number, config: RankedConfig, now = new Date()): Promise<LeaderboardEntryDto[]> {
  const rows = await db.query<{ user_id: string; display_name: string; country: string; points: number; title: Record<string, string> | null }>(
    `SELECT r.user_id, u.display_name, u.country, r.points, t.name AS title
     FROM ranked r JOIN users u ON u.id = r.user_id
     LEFT JOIN user_titles t ON t.user_id = u.id AND t.title_id = u.active_title
     WHERE r.season = $1 AND r.wins + r.losses + r.draws > 0 AND ($2::text IS NULL OR u.country = $2)
     ORDER BY r.points DESC, r.updated_at ASC LIMIT $3`,
    [seasonOf(now).key, country, Math.min(limit, config.leaderboardSize)],
  );
  return rows.map((r, i) => ({
    position: i + 1,
    name: r.display_name,
    title: r.title,
    country: r.country,
    points: r.points,
    rank: rankOf(r.points, config).id,
    you: r.user_id === viewerId,
  }));
}
