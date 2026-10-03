import { Rng, type CardDef } from '@rabbithole/engine';
import type { PassDto, PassReward, PassTierDto, PassTrack } from '@rabbithole/shared';
import type { CatalogSnapshot } from '../catalog/catalog.js';
import type { CardVariant, PassConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { EconomyError } from '../economy/economy.js';

/**
 * Pass saisonnier (section 6.6). Saisons de 28 jours ; niveaux gagnés avec les points de pass (parties en
 * ligne, missions). Trois pistes : gratuite (pièces, boosters gratuits aléatoires), premium et deluxe,
 * achetées en argent réel : cosmétiques (titres, variantes de cartes) et boosters à aperçu, jamais de
 * contenu caché ni d'avantage de jeu. Deluxe inclut premium.
 */

const DAY = 86_400_000;
const RANK: Record<PassTrack, number> = { free: 0, premium: 1, deluxe: 2 };

export function currentSeason(config: PassConfig, now = new Date()): { season: number; startsAt: Date; endsAt: Date } {
  const epoch = Date.parse(`${config.epoch}T00:00:00Z`);
  const length = config.seasonDays * DAY;
  const index = Math.max(0, Math.floor((now.getTime() - epoch) / length));
  const startsAt = new Date(epoch + index * length);
  return { season: index + 1, startsAt, endsAt: new Date(startsAt.getTime() + length) };
}

/** Cartes mises en valeur par les variantes : les plus rares d'abord, ordre tiré pour la saison. */
function variantCards(catalog: CatalogSnapshot, rng: Rng): CardDef[] {
  const order = ['goat', 'iconique', 'viral', 'tendance'];
  const pool = [...catalog.collectibles, ...catalog.leaders].filter((c) => order.includes(c.rarity)).sort((a, b) => a.id.localeCompare(b.id));
  const out: CardDef[] = [];
  while (pool.length) {
    const c = rng.pick(pool);
    pool.splice(pool.indexOf(c), 1);
    out.push(c);
  }
  return out.sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity));
}

/** Récompenses d'une saison, déterministes pour un catalogue donné (contenu de jeu, pas un tirage joueur). */
export function generateRewards(season: number, config: PassConfig, catalog: CatalogSnapshot): PassTierDto[] {
  const rng = Rng.fromSeed(`pass:${season}`);
  const cards = variantCards(catalog, rng);
  let next = 0;
  const variant = (v: CardVariant): PassReward | null => {
    const card = cards[next++ % Math.max(1, cards.length)];
    return card ? { type: 'variant', cardId: card.id, variant: v } : null;
  };
  const title = (id: string, fr: string, en: string): PassReward => ({ type: 'title', id: `s${season}_${id}`, name: { fr, en } });

  const tiers: PassTierDto[] = [];
  for (let tier = 1; tier <= config.tiers; tier++) {
    const free: PassReward = tier % config.freeBoosterEvery === 0 ? { type: 'free_booster', count: 1 } : { type: 'coins', amount: config.freeCoins };
    const premium: PassReward | null =
      tier === 1
        ? title('premium', `Saison ${season} · Premium`, `Season ${season} · Premium`)
        : tier % config.premiumBoosterEvery === 0
          ? { type: 'preview_booster', count: 1 }
          : variant(config.premiumVariants[tier % config.premiumVariants.length]!);
    const deluxe: PassReward | null =
      tier === 1
        ? title('deluxe', `Saison ${season} · Deluxe`, `Season ${season} · Deluxe`)
        : tier === config.tiers
          ? title('legend', `Légende de la saison ${season}`, `Season ${season} legend`)
          : tier % 2 === 0
            ? variant(config.deluxeVariants[(tier / 2) % config.deluxeVariants.length]!)
            : tier % 10 === 5
              ? { type: 'preview_booster', count: 2 }
              : null;
    tiers.push({ tier, free, premium, deluxe });
  }
  return tiers;
}

/** Récompenses figées en base à la première demande de la saison. */
async function seasonRewards(db: Db, season: number, config: PassConfig, catalog: CatalogSnapshot): Promise<PassTierDto[]> {
  const [row] = await db.query<{ rewards: PassTierDto[] }>('SELECT rewards FROM pass_seasons WHERE season = $1', [season]);
  if (row) return row.rewards;
  const rewards = generateRewards(season, config, catalog);
  await db.query('INSERT INTO pass_seasons (season, rewards) VALUES ($1, $2) ON CONFLICT DO NOTHING', [season, JSON.stringify(rewards)]);
  const [saved] = await db.query<{ rewards: PassTierDto[] }>('SELECT rewards FROM pass_seasons WHERE season = $1', [season]);
  return saved!.rewards;
}

interface PassRow {
  xp: number;
  track: PassTrack;
  claimed: Record<PassTrack, number[]>;
}

async function passRow(db: Db, userId: string, season: number): Promise<PassRow> {
  await db.query('INSERT INTO user_pass (user_id, season) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, season]);
  const [row] = await db.query<PassRow>('SELECT xp, track, claimed FROM user_pass WHERE user_id = $1 AND season = $2', [userId, season]);
  return row!;
}

const levelOf = (xp: number, config: PassConfig) => Math.min(config.tiers, Math.floor(xp / config.xpPerTier));

export async function getPass(db: Db, userId: string, config: PassConfig, catalog: CatalogSnapshot, now = new Date()): Promise<PassDto> {
  const s = currentSeason(config, now);
  const row = await passRow(db, userId, s.season);
  return {
    season: s.season,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    xp: row.xp,
    level: levelOf(row.xp, config),
    xpPerTier: config.xpPerTier,
    track: row.track,
    claimed: row.claimed,
    tiers: await seasonRewards(db, s.season, config, catalog),
  };
}

/** Points de pass de la saison en cours (fin de partie, missions). */
export async function addPassXp(db: Db, userId: string, amount: number, config: PassConfig, now = new Date()): Promise<void> {
  if (amount <= 0) return;
  const { season } = currentSeason(config, now);
  await db.query(
    `INSERT INTO user_pass (user_id, season, xp) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, season) DO UPDATE SET xp = user_pass.xp + EXCLUDED.xp`,
    [userId, season, amount],
  );
}

/** Variante sans risque : une erreur de pass ne fait jamais échouer l'action du joueur. */
export async function addPassXpSafe(...args: Parameters<typeof addPassXp>): Promise<void> {
  try {
    await addPassXp(...args);
  } catch {
    // Points perdus pour cet événement, l'action principale aboutit.
  }
}

async function grant(db: Db, userId: string, reward: PassReward, ref: string): Promise<void> {
  switch (reward.type) {
    case 'coins':
      await db.query('UPDATE wallets SET coins = coins + $2 WHERE user_id = $1', [userId, reward.amount]);
      await db.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'pass', $3)", [userId, reward.amount, ref]);
      return;
    case 'free_booster':
      await db.query('UPDATE wallets SET free_boosters = free_boosters + $2 WHERE user_id = $1', [userId, reward.count]);
      await db.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'free_boosters', $2, 'pass', $3)", [userId, reward.count, ref]);
      return;
    case 'preview_booster':
      await db.query('UPDATE wallets SET preview_boosters = preview_boosters + $2 WHERE user_id = $1', [userId, reward.count]);
      await db.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'preview_boosters', $2, 'pass', $3)", [userId, reward.count, ref]);
      return;
    case 'title':
      await db.query('INSERT INTO user_titles (user_id, title_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, reward.id, JSON.stringify(reward.name)]);
      return;
    case 'variant':
      await db.query('INSERT INTO user_card_variants (user_id, card_id, variant) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, reward.cardId, reward.variant]);
      return;
  }
}

/** Réclamer la récompense d'un niveau atteint, sur une piste accessible (deluxe inclut premium). */
export async function claimTier(db: Db, userId: string, tier: number, track: PassTrack, config: PassConfig, catalog: CatalogSnapshot, now = new Date()): Promise<PassReward> {
  const { season } = currentSeason(config, now);
  const tiers = await seasonRewards(db, season, config, catalog);
  return db.transaction(async (tx) => {
    const row = await passRow(tx, userId, season);
    if (tier < 1 || tier > levelOf(row.xp, config)) throw new EconomyError('tier_locked', 409);
    if (RANK[row.track] < RANK[track]) throw new EconomyError('track_locked', 403);
    if (row.claimed[track]?.includes(tier)) throw new EconomyError('already_claimed', 409);
    const reward = tiers[tier - 1]?.[track];
    if (!reward) throw new EconomyError('no_reward', 404);
    await tx.query(`UPDATE user_pass SET claimed = jsonb_set(claimed, $3, (claimed -> $4) || to_jsonb($5::int)) WHERE user_id = $1 AND season = $2`, [
      userId,
      season,
      `{${track}}`,
      track,
      tier,
    ]);
    await grant(tx, userId, reward, `s${season}:${track}:${tier}`);
    return reward;
  });
}

/** Piste payée : premium ou deluxe (jamais de rétrogradation par un achat). */
export async function setTrack(db: Db, userId: string, season: number, track: PassTrack): Promise<void> {
  await db.query('INSERT INTO user_pass (user_id, season) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, season]);
  await db.query(
    `UPDATE user_pass SET track = $3 WHERE user_id = $1 AND season = $2
       AND (CASE track WHEN 'free' THEN 0 WHEN 'premium' THEN 1 ELSE 2 END) < (CASE $3 WHEN 'free' THEN 0 WHEN 'premium' THEN 1 ELSE 2 END)`,
    [userId, season, track],
  );
}

/** Après un remboursement : la piste redevient celle des achats encore valables de la saison. */
export async function recomputeTrack(db: Db, userId: string, season: number): Promise<void> {
  const rows = await db.query<{ product_id: string }>(
    `SELECT product_id FROM transactions WHERE user_id = $1 AND status = 'completed' AND (contents ->> 'season')::int = $2 AND contents ? 'pass'`,
    [userId, season],
  );
  const ids = new Set(rows.map((r) => r.product_id));
  const track: PassTrack = ids.has('pass_deluxe') || (ids.has('pass_upgrade') && ids.has('pass_premium')) ? 'deluxe' : ids.has('pass_premium') ? 'premium' : 'free';
  await db.query('UPDATE user_pass SET track = $3 WHERE user_id = $1 AND season = $2', [userId, season, track]);
}

/** Achats de pass possibles selon la piste actuelle : premium ou deluxe depuis la piste gratuite, le passage au deluxe depuis premium. */
export async function assertPassPurchasable(db: Db, userId: string, productId: string, config: PassConfig, now = new Date()): Promise<number> {
  const { season } = currentSeason(config, now);
  const row = await passRow(db, userId, season);
  const allowed = row.track === 'free' ? ['pass_premium', 'pass_deluxe'] : row.track === 'premium' ? ['pass_upgrade'] : [];
  if (!allowed.includes(productId)) throw new EconomyError('pass_not_available', 409);
  return season;
}

/** Cosmétiques visibles en partie : variante affichée de chaque carte et titre actif. */
export async function playerCosmetics(db: Db, userId: string): Promise<{ variants: Record<string, string>; title: Record<string, string> | null }> {
  const variants = await db.query<{ card_id: string; variant: string }>('SELECT card_id, variant FROM user_card_variants WHERE user_id = $1 AND equipped', [userId]);
  const [title] = await db.query<{ name: Record<string, string> }>(
    'SELECT t.name FROM users u JOIN user_titles t ON t.user_id = u.id AND t.title_id = u.active_title WHERE u.id = $1',
    [userId],
  );
  return { variants: Object.fromEntries(variants.map((v) => [v.card_id, v.variant])), title: title?.name ?? null };
}
