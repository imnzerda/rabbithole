import { randomBytes } from 'node:crypto';
import { CATEGORIES, Rng, type CategoryId } from '@rabbithole/engine';
import type { MissionDto } from '@rabbithole/shared';
import type { MissionKind, MissionsConfig, MissionTemplate } from '../config.js';
import type { Db } from '../db/db.js';
import { EconomyError } from '../economy/economy.js';

/**
 * Missions quotidiennes et hebdomadaires (section 13). Pour chaque joueur et chaque période, le serveur tire
 * des missions parmi les modèles de la config (RNG `crypto`, seed enregistrée). La progression est comptée
 * côté serveur (fin de partie, boosters, trade-up, échanges, fabrication) ; la récompense se réclame une fois.
 * Les périodes changent à minuit UTC, et le lundi pour la semaine.
 */

type Period = 'daily' | 'weekly';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Clés des périodes en cours et leur fin. */
export function periods(now = new Date()): Record<Period, { key: string; endsAt: Date }> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dailyEnd = new Date(start.getTime() + 86_400_000);
  // Lundi de la semaine (getUTCDay : 0 = dimanche).
  const monday = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * 86_400_000);
  const weeklyEnd = new Date(monday.getTime() + 7 * 86_400_000);
  return { daily: { key: day(start), endsAt: dailyEnd }, weekly: { key: day(monday), endsAt: weeklyEnd } };
}

/** Tire `count` modèles distincts (par type de mission) ; la catégorie d'une mission « catégorie » est tirée aussi. */
function draw(templates: MissionTemplate[], count: number, seed: string): (MissionTemplate & { category: CategoryId | null })[] {
  const rng = Rng.fromSeed(seed);
  const pool = [...templates];
  const out: (MissionTemplate & { category: CategoryId | null })[] = [];
  while (out.length < count && pool.length) {
    const t = rng.pick(pool);
    pool.splice(pool.indexOf(t), 1);
    out.push({ ...t, category: t.kind === 'play_category' ? rng.pick(CATEGORIES) : null });
  }
  return out;
}

/** Missions de la période en cours : tirées à la première demande de la période. */
async function ensure(db: Db, userId: string, config: MissionsConfig, now: Date): Promise<void> {
  const p = periods(now);
  for (const period of ['daily', 'weekly'] as const) {
    const [exists] = await db.query('SELECT 1 FROM user_missions WHERE user_id = $1 AND period = $2 AND period_key = $3 LIMIT 1', [userId, period, p[period].key]);
    if (exists) continue;
    const seed = randomBytes(16).toString('hex');
    const picked = draw(period === 'daily' ? config.daily : config.weekly, period === 'daily' ? config.dailyCount : config.weeklyCount, seed);
    for (const m of picked) {
      await db.query(
        `INSERT INTO user_missions (user_id, period, period_key, kind, category, target, coins, xp, seed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [userId, period, p[period].key, m.kind, m.category, m.target, m.coins, m.xp, seed],
      );
    }
  }
}

interface Row {
  id: string;
  period: Period;
  kind: MissionKind;
  category: CategoryId | null;
  target: number;
  progress: number;
  coins: number;
  xp: number;
  claimed_at: string | Date | null;
}

export async function listMissions(db: Db, userId: string, config: MissionsConfig, now = new Date()): Promise<Record<Period, { endsAt: string; missions: MissionDto[] }>> {
  await ensure(db, userId, config, now);
  const p = periods(now);
  const rows = await db.query<Row>(
    `SELECT id, period, kind, category, target, progress, coins, xp, claimed_at FROM user_missions
     WHERE user_id = $1 AND ((period = 'daily' AND period_key = $2) OR (period = 'weekly' AND period_key = $3)) ORDER BY created_at, kind`,
    [userId, p.daily.key, p.weekly.key],
  );
  const dto = (r: Row): MissionDto => ({ id: r.id, kind: r.kind, category: r.category, target: r.target, progress: r.progress, coins: r.coins, xp: r.xp, claimed: r.claimed_at !== null });
  return {
    daily: { endsAt: p.daily.endsAt.toISOString(), missions: rows.filter((r) => r.period === 'daily').map(dto) },
    weekly: { endsAt: p.weekly.endsAt.toISOString(), missions: rows.filter((r) => r.period === 'weekly').map(dto) },
  };
}

/** Un événement de jeu fait avancer les missions en cours qui le comptent. */
export async function recordMission(db: Db, userId: string, kind: MissionKind, amount: number, config: MissionsConfig, category: CategoryId | null = null, now = new Date()): Promise<void> {
  if (amount <= 0) return;
  await ensure(db, userId, config, now);
  const p = periods(now);
  await db.query(
    `UPDATE user_missions SET progress = LEAST(target, progress + $3)
     WHERE user_id = $1 AND kind = $2 AND claimed_at IS NULL AND progress < target
       AND ((period = 'daily' AND period_key = $4) OR (period = 'weekly' AND period_key = $5))
       AND (category IS NULL OR category = $6)`,
    [userId, kind, amount, p.daily.key, p.weekly.key, category],
  );
}

/** Réclamer une mission terminée de la période en cours : pièces créditées une seule fois. */
export async function claimMission(db: Db, userId: string, missionId: string, now = new Date()): Promise<{ coins: number; xp: number }> {
  const p = periods(now);
  return db.transaction(async (tx) => {
    const [m] = await tx.query<{ coins: number; xp: number }>(
      `UPDATE user_missions SET claimed_at = now()
       WHERE id = $1 AND user_id = $2 AND claimed_at IS NULL AND progress >= target
         AND ((period = 'daily' AND period_key = $3) OR (period = 'weekly' AND period_key = $4))
       RETURNING coins, xp`,
      [missionId, userId, p.daily.key, p.weekly.key],
    );
    if (!m) throw new EconomyError('mission_not_claimable', 409);
    await tx.query('UPDATE wallets SET coins = coins + $2 WHERE user_id = $1', [userId, m.coins]);
    await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'mission', $3)", [userId, m.coins, missionId]);
    return m;
  });
}

/** Variante sans risque : une erreur de mission ne fait jamais échouer l'action du joueur. */
export async function recordMissionSafe(...args: Parameters<typeof recordMission>): Promise<void> {
  try {
    await recordMission(...args);
  } catch {
    // La progression est perdue pour cet événement, l'action principale aboutit.
  }
}
