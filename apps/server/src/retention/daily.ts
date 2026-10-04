import { Rng, type MatchContext, type MatchResult, type PlayerIndex } from '@rabbithole/engine';
import type { DailyDto, DailyResultDto } from '@rabbithole/shared';
import type { DailyConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { referenceDecks, type ReferenceDeck } from '../decks/reference.js';

/**
 * Défi du jour (section 7) : le même deck imposé, le même adversaire IA et la même seed pour tout le monde
 * (l'IA tire ses choix de la seed de la partie : à coups identiques, partie identique). Une seule tentative
 * comptée par joueur et par jour (UTC), avec un score partagé et classé.
 */

export const dailyKey = (now = new Date()) => now.toISOString().slice(0, 10);

export interface DailyChallenge {
  date: string;
  seed: string;
  deck: ReferenceDeck;
  opponent: ReferenceDeck;
}

/** Deck et adversaire du jour, tirés de façon déterministe parmi les decks de référence (série publiée d'abord). */
export async function dailyChallenge(db: Db, ctx: MatchContext, now = new Date()): Promise<DailyChallenge | null> {
  const refs = await referenceDecks(db, ctx);
  const series = refs.filter((d) => d.series !== 'prototype');
  const pool = (series.length >= 2 ? series : refs).sort((a, b) => a.id.localeCompare(b.id));
  if (pool.length < 2) return null;
  const date = dailyKey(now);
  const rng = Rng.fromSeed(`daily:${date}:decks`);
  const deck = rng.pick(pool);
  const opponent = rng.pick(pool.filter((d) => d.id !== deck.id));
  return { date, seed: `daily:${date}`, deck, opponent };
}

export function dailyScore(result: MatchResult, you: PlayerIndex, opponentStartLives: number, config: DailyConfig): Omit<DailyResultDto, 'lives' | 'opponentLives'> {
  const won = result.winner === you;
  const livesLeft = result.life[you];
  // Avant le premier tour (abandon pendant le mulligan), les Vies ne sont pas encore distribuées : rien de pris.
  const livesTaken = result.turns === 0 ? 0 : Math.max(0, opponentStartLives - result.life[you === 0 ? 1 : 0]);
  const s = config.score;
  const score = Math.max(0, (won ? s.win : 0) + livesLeft * s.lifeLeft + livesTaken * s.lifeTaken - result.turns * s.perTurn);
  return { won, turns: result.turns, livesLeft, livesTaken, score };
}

export async function hasPlayedDaily(db: Db, userId: string, now = new Date()): Promise<boolean> {
  const [row] = await db.query('SELECT 1 FROM daily_results WHERE user_id = $1 AND date = $2', [userId, dailyKey(now)]);
  return !!row;
}

/** Enregistre la tentative du jour (la première seulement) et verse la récompense ; renvoie les pièces, ou null. */
export async function recordDaily(
  db: Db,
  userId: string,
  date: string,
  matchId: string,
  result: MatchResult,
  you: PlayerIndex,
  opponentStartLives: number,
  config: DailyConfig,
): Promise<number | null> {
  const r = dailyScore(result, you, opponentStartLives, config);
  return db.transaction(async (tx) => {
    const fresh = await tx.query(
      `INSERT INTO daily_results (user_id, date, match_id, won, turns, lives_left, lives_taken, score) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING RETURNING 1`,
      [userId, date, matchId, r.won, r.turns, r.livesLeft, r.livesTaken, r.score],
    );
    if (fresh.length === 0) return null;
    const coins = r.won ? config.reward.win : config.reward.loss;
    await tx.query('UPDATE wallets SET coins = coins + $2 WHERE user_id = $1', [userId, coins]);
    await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'daily', $3)", [userId, coins, date]);
    return coins;
  });
}

export async function getDaily(db: Db, userId: string, ctx: MatchContext, config: DailyConfig, now = new Date()): Promise<DailyDto | null> {
  const challenge = await dailyChallenge(db, ctx, now);
  if (!challenge) return null;
  const date = challenge.date;
  const [mine] = await db.query<{ won: boolean; turns: number; lives_left: number; lives_taken: number; score: number; created_at: string | Date }>(
    'SELECT won, turns, lives_left, lives_taken, score, created_at FROM daily_results WHERE user_id = $1 AND date = $2',
    [userId, date],
  );
  const rows = await db.query<{ user_id: string; display_name: string; score: number; won: boolean; turns: number }>(
    `SELECT r.user_id, u.display_name, r.score, r.won, r.turns FROM daily_results r JOIN users u ON u.id = r.user_id
     WHERE r.date = $1 ORDER BY r.score DESC, r.created_at ASC LIMIT $2`,
    [date, config.leaderboardSize],
  );
  const [players] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM daily_results WHERE date = $1', [date]);
  const [ahead] = mine
    ? await db.query<{ n: number }>('SELECT count(*)::int AS n FROM daily_results WHERE date = $1 AND (score > $2 OR (score = $2 AND created_at < $3))', [date, mine.score, mine.created_at])
    : [];
  const lives = (leader: string) => ctx.cards[leader]?.life ?? 5;
  return {
    date,
    deck: { name: challenge.deck.name, leader: challenge.deck.leader, cards: challenge.deck.cards },
    opponent: { name: challenge.opponent.name, leader: challenge.opponent.leader },
    result: mine
      ? {
          won: mine.won,
          turns: mine.turns,
          livesLeft: mine.lives_left,
          livesTaken: mine.lives_taken,
          score: mine.score,
          lives: lives(challenge.deck.leader),
          opponentLives: lives(challenge.opponent.leader),
        }
      : null,
    leaderboard: rows.map((r, i) => ({ position: i + 1, name: r.display_name, score: r.score, won: r.won, turns: r.turns, you: r.user_id === userId })),
    position: mine ? (ahead?.n ?? 0) + 1 : null,
    players: players?.n ?? 0,
  };
}
