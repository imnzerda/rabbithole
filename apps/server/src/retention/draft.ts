import { randomBytes, randomUUID } from 'node:crypto';
import { Rng, type CardDef, type Rarity } from '@rabbithole/engine';
import type { DraftDto, DraftRewardDto, DraftRunDto } from '@rabbithole/shared';
import type { CatalogSnapshot } from '../catalog/catalog.js';
import type { DraftConfig, EconomyConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { EconomyError } from '../economy/economy.js';

/**
 * Draft du week-end (section 7). Le serveur tire une seed (RNG cryptographique) à l'entrée ; toutes les propositions
 * (Leaders, puis cartes) en dérivent, ce qui permet de les auditer. Le joueur choisit un Leader, puis une carte par
 * proposition jusqu'à un deck complet, toujours dans les catégories du Leader et sans dépasser le nombre d'exemplaires
 * autorisé : le deck obtenu est valide par construction. Il joue ensuite jusqu'à `maxWins` victoires ou `maxLosses`
 * défaites ; la récompense dépend des victoires. Les cartes choisies ne sont pas gardées.
 */

/** Samedi (UTC) de la semaine en cours : clé du week-end, pour l'entrée gratuite. */
export function draftWeek(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7));
  return d.toISOString().slice(0, 10);
}

export function draftOpen(config: DraftConfig, now = new Date()): boolean {
  return config.alwaysOpen || config.days.includes(now.getUTCDay());
}

/** Prochaine ouverture (minuit UTC du prochain jour ouvert), quand le draft est fermé. */
function nextOpening(config: DraftConfig, now: Date): string | null {
  if (draftOpen(config, now) || !config.days.length) return null;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  do d.setUTCDate(d.getUTCDate() + 1);
  while (!config.days.includes(d.getUTCDay()));
  return d.toISOString();
}

interface RunRow {
  id: string;
  week: string;
  entry: 'free' | 'coins';
  seed: string;
  leader_choices: string[];
  leader_id: string | null;
  offer: string[];
  picks: string[];
  wins: number;
  losses: number;
  status: 'picking' | 'playing' | 'done';
  reward_coins: number | null;
  reward_boosters: number | null;
}

const RUN_COLUMNS = 'id, week, entry, seed, leader_choices, leader_id, offer, picks, wins, losses, status, reward_coins, reward_boosters';

async function activeRun(db: Db, userId: string): Promise<RunRow | null> {
  const [row] = await db.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM draft_runs WHERE user_id = $1 AND status <> 'done'`, [userId]);
  return row ?? null;
}

/** Cartes que le Leader accepte (catégorie commune), hors cartes bloquées pour le joueur. */
function eligibleFor(catalog: CatalogSnapshot, leaderId: string, blocked: ReadonlySet<string>): CardDef[] {
  const leader = catalog.ctx.cards[leaderId];
  if (!leader) return [];
  return catalog.collectibles.filter((c) => !blocked.has(c.id) && c.categories.some((cat) => leader.categories.includes(cat)));
}

/** Un Leader se draft s'il a assez de cartes pour remplir un deck (les dernières propositions peuvent être plus courtes). */
function draftable(catalog: CatalogSnapshot, leaderId: string, blocked: ReadonlySet<string>): boolean {
  return eligibleFor(catalog, leaderId, blocked).length * catalog.ctx.rules.maxCopiesPerCard >= catalog.ctx.rules.deckSize;
}

function leaderChoices(seed: string, catalog: CatalogSnapshot, blocked: ReadonlySet<string>, config: DraftConfig): string[] {
  const pool = catalog.leaders.filter((l) => !blocked.has(l.id) && draftable(catalog, l.id, blocked)).map((l) => l.id);
  const rng = Rng.fromSeed(`${seed}:leaders`);
  const out: string[] = [];
  while (out.length < config.leaderChoices && pool.length) out.push(pool.splice(rng.int(pool.length), 1)[0]!);
  return out;
}

/**
 * Proposition n° `picks.length` : `choices` cartes différentes, rareté tirée selon les poids des boosters,
 * sans les cartes déjà au maximum d'exemplaires.
 */
function offerFor(seed: string, catalog: CatalogSnapshot, leaderId: string, picks: readonly string[], blocked: ReadonlySet<string>, config: DraftConfig, economy: EconomyConfig): string[] {
  const max = catalog.ctx.rules.maxCopiesPerCard;
  const count = new Map<string, number>();
  for (const id of picks) count.set(id, (count.get(id) ?? 0) + 1);
  let pool = eligibleFor(catalog, leaderId, blocked).filter((c) => (count.get(c.id) ?? 0) < max);
  const rng = Rng.fromSeed(`${seed}:pick:${picks.length}`);
  const offer: string[] = [];
  while (offer.length < config.choices && pool.length) {
    const rarities = [...new Set(pool.map((c) => c.rarity))] as Rarity[];
    const rarity = rarities[rng.weighted(rarities.map((r) => economy.rarityWeights[r] ?? 1))]!;
    const ofRarity = pool.filter((c) => c.rarity === rarity);
    const card = ofRarity[rng.int(ofRarity.length)]!;
    offer.push(card.id);
    pool = pool.filter((c) => c.id !== card.id);
  }
  return offer;
}

function rewardFor(wins: number, config: DraftConfig): DraftRewardDto {
  const r = config.rewards[Math.min(wins, config.rewards.length - 1)] ?? { coins: 0, freeBoosters: 0 };
  return { coins: r.coins, freeBoosters: r.freeBoosters };
}

function toDto(row: RunRow, deckSize: number): DraftRunDto {
  return {
    id: row.id,
    status: row.status,
    entry: row.entry,
    leader: row.leader_id,
    leaderChoices: row.leader_choices,
    offer: row.offer,
    picks: row.picks,
    deckSize,
    wins: row.wins,
    losses: row.losses,
    reward: row.reward_coins === null ? null : { coins: row.reward_coins, freeBoosters: row.reward_boosters ?? 0 },
  };
}

async function freeLeft(db: Db, userId: string, week: string, config: DraftConfig): Promise<number> {
  const [row] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM draft_runs WHERE user_id = $1 AND week = $2 AND entry = 'free'", [userId, week]);
  return Math.max(0, config.freePerWeekend - (row?.n ?? 0));
}

export async function getDraft(db: Db, userId: string, catalog: CatalogSnapshot, config: DraftConfig, now = new Date()): Promise<DraftDto> {
  const week = draftWeek(now);
  // Draft en cours, sinon le dernier de la semaine (pour afficher son résultat).
  const run =
    (await activeRun(db, userId)) ??
    (await db.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM draft_runs WHERE user_id = $1 AND week = $2 ORDER BY created_at DESC LIMIT 1`, [userId, week]))[0] ??
    null;
  return {
    open: draftOpen(config, now),
    opensAt: nextOpening(config, now),
    week,
    entryCoins: config.entryCoins,
    freeLeft: await freeLeft(db, userId, week, config),
    maxWins: config.maxWins,
    maxLosses: config.maxLosses,
    rewards: config.rewards.map((_, wins) => rewardFor(wins, config)),
    run: run ? toDto(run, catalog.ctx.rules.deckSize) : null,
  };
}

/** Entrée dans le draft : gratuite (une fois par week-end) ou en pièces. */
export async function startDraft(
  db: Db,
  userId: string,
  pay: 'free' | 'coins',
  catalog: CatalogSnapshot,
  blocked: ReadonlySet<string>,
  config: DraftConfig,
  now = new Date(),
): Promise<void> {
  if (!draftOpen(config, now)) throw new EconomyError('draft_closed', 409);
  if (await activeRun(db, userId)) throw new EconomyError('draft_in_progress', 409);
  const seed = randomBytes(16).toString('hex');
  const leaders = leaderChoices(seed, catalog, blocked, config);
  if (!leaders.length) throw new EconomyError('draft_unavailable', 409);
  const week = draftWeek(now);
  await db.transaction(async (tx) => {
    if (pay === 'free') {
      if ((await freeLeft(tx, userId, week, config)) <= 0) throw new EconomyError('no_free_draft', 402);
    } else {
      const paid = await tx.query('UPDATE wallets SET coins = coins - $2 WHERE user_id = $1 AND coins >= $2 RETURNING coins', [userId, config.entryCoins]);
      if (paid.length === 0) throw new EconomyError('not_enough_coins', 402);
      await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'draft_entry', $3)", [userId, -config.entryCoins, week]);
    }
    await tx.query('INSERT INTO draft_runs (id, user_id, week, entry, seed, leader_choices) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), userId, week, pay, seed, leaders]);
  });
}

/** Choix du Leader (première étape), puis d'une carte de la proposition en cours. */
export async function pickDraft(
  db: Db,
  userId: string,
  cardId: string,
  catalog: CatalogSnapshot,
  blocked: ReadonlySet<string>,
  config: DraftConfig,
  economy: EconomyConfig,
): Promise<void> {
  const run = await activeRun(db, userId);
  if (!run || run.status !== 'picking') throw new EconomyError('no_draft_pick', 409);
  const deckSize = catalog.ctx.rules.deckSize;
  if (!run.leader_id) {
    if (!run.leader_choices.includes(cardId)) throw new EconomyError('not_offered', 400);
    const offer = offerFor(run.seed, catalog, cardId, [], blocked, config, economy);
    await db.query('UPDATE draft_runs SET leader_id = $2, offer = $3 WHERE id = $1', [run.id, cardId, offer]);
    return;
  }
  if (!run.offer.includes(cardId)) throw new EconomyError('not_offered', 400);
  const picks = [...run.picks, cardId];
  const done = picks.length >= deckSize;
  const offer = done ? [] : offerFor(run.seed, catalog, run.leader_id, picks, blocked, config, economy);
  // Garde-fou : plus rien à proposer avant d'avoir un deck complet (catalogue modifié entre-temps).
  if (!done && offer.length === 0) throw new EconomyError('draft_unavailable', 409);
  await db.query('UPDATE draft_runs SET picks = $2, offer = $3, status = $4 WHERE id = $1 AND status = $5', [run.id, picks, offer, done ? 'playing' : 'picking', 'picking']);
}

/** Termine le draft et verse la récompense des victoires obtenues. */
async function finish(db: Db, userId: string, runId: string, wins: number, config: DraftConfig): Promise<DraftRewardDto | null> {
  const reward = rewardFor(wins, config);
  return db.transaction(async (tx) => {
    const ended = await tx.query(
      "UPDATE draft_runs SET status = 'done', reward_coins = $2, reward_boosters = $3, ended_at = now() WHERE id = $1 AND status <> 'done' RETURNING 1",
      [runId, reward.coins, reward.freeBoosters],
    );
    if (ended.length === 0) return null;
    await tx.query('UPDATE wallets SET coins = coins + $2, free_boosters = free_boosters + $3 WHERE user_id = $1', [userId, reward.coins, reward.freeBoosters]);
    if (reward.coins) await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'draft_reward', $3)", [userId, reward.coins, runId]);
    if (reward.freeBoosters)
      await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'free_boosters', $2, 'draft_reward', $3)", [userId, reward.freeBoosters, runId]);
    return reward;
  });
}

/** Abandon du draft : il se termine avec la récompense des victoires déjà obtenues. */
export async function retireDraft(db: Db, userId: string, config: DraftConfig): Promise<DraftRewardDto> {
  const run = await activeRun(db, userId);
  if (!run) throw new EconomyError('no_draft', 409);
  const reward = await finish(db, userId, run.id, run.wins, config);
  if (!reward) throw new EconomyError('no_draft', 409);
  return reward;
}

/** Deck du draft en cours, prêt à jouer. */
export async function draftDeck(db: Db, userId: string): Promise<{ runId: string; leader: string; cards: string[] } | null> {
  const run = await activeRun(db, userId);
  if (!run || run.status !== 'playing' || !run.leader_id) return null;
  return { runId: run.id, leader: run.leader_id, cards: run.picks };
}

/**
 * Résultat d'une partie de draft (un nul compte comme une défaite). Renvoie la récompense quand le draft se termine.
 */
export async function recordDraftResult(db: Db, userId: string, runId: string, won: boolean, config: DraftConfig): Promise<DraftRewardDto | null> {
  const [row] = await db.query<{ wins: number; losses: number }>(
    `UPDATE draft_runs SET wins = wins + $3, losses = losses + $4 WHERE id = $1 AND user_id = $2 AND status = 'playing' RETURNING wins, losses`,
    [runId, userId, won ? 1 : 0, won ? 0 : 1],
  );
  if (!row) return null;
  if (row.wins < config.maxWins && row.losses < config.maxLosses) return null;
  return finish(db, userId, runId, row.wins, config);
}

/** Decks de draft récents d'autres joueurs, pour les fantômes du mode draft. */
export async function recentDraftDecks(db: Db, userId: string, deckSize: number): Promise<{ userId: string; name: string; leader: string; cards: string[] }[]> {
  const rows = await db.query<{ user_id: string; display_name: string; leader_id: string; picks: string[] }>(
    `SELECT r.user_id, u.display_name, r.leader_id, r.picks FROM draft_runs r JOIN users u ON u.id = r.user_id
     WHERE r.user_id <> $1 AND r.leader_id IS NOT NULL AND cardinality(r.picks) = $2 ORDER BY r.created_at DESC LIMIT 50`,
    [userId, deckSize],
  );
  return rows.map((r) => ({ userId: r.user_id, name: r.display_name, leader: r.leader_id, cards: r.picks }));
}
