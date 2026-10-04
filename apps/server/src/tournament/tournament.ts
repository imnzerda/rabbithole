import { randomBytes, randomUUID } from 'node:crypto';
import { Rng, simulateMatchup, type MatchContext } from '@rabbithole/engine';
import type { TournamentDto, TournamentSlotDto, TournamentsDto } from '@rabbithole/shared';
import type { User } from '../auth/accounts.js';
import type { CatalogSnapshot } from '../catalog/catalog.js';
import type { TournamentConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { checkDeck, getDeck } from '../decks/decks.js';
import { EconomyError } from '../economy/economy.js';

/**
 * Tournoi hebdomadaire (section 7), élimination directe.
 * - Inscriptions jusqu'au début, avec une copie figée d'un de ses decks (possession vérifiée).
 * - Au début : tableau tiré au sort (seed cryptographique enregistrée), puissance de 2 avec exemptions au premier tour.
 * - Chaque tour a une échéance : les deux joueurs jouent leur match en direct (file « tournament ») ; à l'échéance,
 *   un match non joué est tranché par une simulation IA contre IA des deux decks, déterministe pour la seed.
 * - À la fin : classement (1, 2, 4, 8…), récompenses et titre du champion.
 */

interface TournamentRow {
  id: string;
  start_date: string;
  starts_at: Date | string;
  status: 'registering' | 'running' | 'done' | 'cancelled';
  seed: string | null;
  round: number;
  rounds: number;
  round_ends_at: Date | string | null;
}

interface SlotRow {
  round: number;
  slot: number;
  player_a: string | null;
  player_b: string | null;
  winner: string | null;
  how: 'bye' | 'played' | 'simulated' | null;
  match_id: string | null;
  live_started_at: Date | string | null;
}

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

/** Prochain début (strictement après `now`) : le `startDay` à `startHour` UTC. */
export function nextStart(config: Pick<TournamentConfig, 'startDay' | 'startHour'>, now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), config.startHour));
  while (d.getUTCDay() !== config.startDay || d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Tournoi ouvert aux inscriptions (créé au besoin). */
async function registeringTournament(db: Db, config: TournamentConfig, now: Date): Promise<TournamentRow> {
  const start = nextStart(config, now);
  const date = start.toISOString().slice(0, 10);
  await db.query('INSERT INTO tournaments (id, start_date, starts_at) VALUES ($1, $2, $3) ON CONFLICT (start_date) DO NOTHING', [randomUUID(), date, start]);
  const [row] = await db.query<TournamentRow>('SELECT * FROM tournaments WHERE start_date = $1', [date]);
  return row!;
}

export async function registerTournament(
  db: Db,
  user: Pick<User, 'id'>,
  deckId: string,
  ctx: MatchContext,
  blocked: Set<string>,
  config: TournamentConfig,
  now = new Date(),
): Promise<void> {
  const t = await registeringTournament(db, config, now);
  if (t.status !== 'registering') throw new EconomyError('tournament_closed', 409);
  const deck = await getDeck(db, user.id, deckId);
  if (!deck) throw new EconomyError('deck_not_found', 404);
  const errors = await checkDeck(db, ctx, user.id, deck.leaderId, deck.cardIds, blocked);
  if (errors.length) throw new EconomyError('invalid_deck', 400);
  const [count] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM tournament_players WHERE tournament_id = $1 AND user_id <> $2', [t.id, user.id]);
  if ((count?.n ?? 0) >= config.maxPlayers) throw new EconomyError('tournament_full', 409);
  // Changer de deck avant le début remplace la copie.
  await db.query(
    `INSERT INTO tournament_players (tournament_id, user_id, leader_id, card_ids) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tournament_id, user_id) DO UPDATE SET leader_id = EXCLUDED.leader_id, card_ids = EXCLUDED.card_ids`,
    [t.id, user.id, deck.leaderId, deck.cardIds],
  );
}

export async function unregisterTournament(db: Db, userId: string, config: TournamentConfig, now = new Date()): Promise<void> {
  const t = await registeringTournament(db, config, now);
  await db.query('DELETE FROM tournament_players WHERE tournament_id = $1 AND user_id = $2', [t.id, userId]);
}

/** Démarre les tournois arrivés à leur heure : tableau tiré au sort, ou annulation faute de joueurs. */
export async function startDueTournaments(db: Db, config: TournamentConfig, now = new Date()): Promise<void> {
  const due = await db.query<TournamentRow>("SELECT * FROM tournaments WHERE status = 'registering' AND starts_at <= $1", [now]);
  for (const t of due) await startTournament(db, t, config, now);
}

async function startTournament(db: Db, t: TournamentRow, config: TournamentConfig, now: Date): Promise<void> {
  const players = (await db.query<{ user_id: string }>('SELECT user_id FROM tournament_players WHERE tournament_id = $1 ORDER BY registered_at, user_id', [t.id])).map((p) => p.user_id);
  if (players.length < config.minPlayers) {
    await db.query("UPDATE tournaments SET status = 'cancelled', ended_at = $2 WHERE id = $1 AND status = 'registering'", [t.id, now]);
    return;
  }
  const seed = randomBytes(16).toString('hex');
  const rng = Rng.fromSeed(`${seed}:bracket`);
  for (let i = players.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [players[i], players[j]] = [players[j]!, players[i]!];
  }
  const rounds = Math.ceil(Math.log2(players.length));
  const slots = 2 ** rounds / 2;
  const byes = 2 ** rounds - players.length;
  await db.transaction(async (tx) => {
    const started = await tx.query(
      "UPDATE tournaments SET status = 'running', seed = $2, round = 1, rounds = $3, round_ends_at = $4 WHERE id = $1 AND status = 'registering' RETURNING 1",
      [t.id, seed, rounds, new Date(now.getTime() + config.roundHours * 3_600_000)],
    );
    if (started.length === 0) return;
    let next = 0;
    for (let slot = 0; slot < slots; slot++) {
      // Les premiers tirés sont exemptés du premier tour (un seul joueur dans leur match).
      const a = players[next++]!;
      const b = slot < byes ? null : players[next++]!;
      await tx.query('INSERT INTO tournament_matches (tournament_id, round, slot, player_a, player_b, winner, how) VALUES ($1, 1, $2, $3, $4, $5, $6)', [
        t.id,
        slot,
        a,
        b,
        b ? null : a,
        b ? null : 'bye',
      ]);
    }
  });
  await advanceTournament(db, t.id, config, now);
}

/** Passe au tour suivant quand tous les matchs du tour sont tranchés ; termine le tournoi après la finale. */
export async function advanceTournament(db: Db, tournamentId: string, config: TournamentConfig, now = new Date()): Promise<void> {
  for (;;) {
    const [t] = await db.query<TournamentRow>('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
    if (!t || t.status !== 'running') return;
    const rows = await db.query<SlotRow>('SELECT * FROM tournament_matches WHERE tournament_id = $1 AND round = $2 ORDER BY slot', [t.id, t.round]);
    if (rows.some((r) => !r.winner)) return;
    if (t.round >= t.rounds) {
      await finishTournament(db, t, config, now);
      return;
    }
    await db.transaction(async (tx) => {
      const moved = await tx.query('UPDATE tournaments SET round = round + 1, round_ends_at = $3 WHERE id = $1 AND round = $2 RETURNING 1', [
        t.id,
        t.round,
        new Date(now.getTime() + config.roundHours * 3_600_000),
      ]);
      if (moved.length === 0) return;
      for (let slot = 0; slot < rows.length / 2; slot++) {
        await tx.query('INSERT INTO tournament_matches (tournament_id, round, slot, player_a, player_b) VALUES ($1, $2, $3, $4, $5)', [
          t.id,
          t.round + 1,
          slot,
          rows[2 * slot]!.winner,
          rows[2 * slot + 1]!.winner,
        ]);
      }
    });
  }
}

/**
 * Échéance d'un tour : chaque match non joué est tranché par une partie IA contre IA des deux decks
 * (sauf un match en direct commencé depuis peu, qui va se terminer). En cas de nul, tirage à pile ou face de la seed.
 */
export async function resolveDueRounds(db: Db, ctx: MatchContext, config: TournamentConfig, now = new Date()): Promise<void> {
  const due = await db.query<TournamentRow>("SELECT * FROM tournaments WHERE status = 'running' AND round_ends_at <= $1", [now]);
  const grace = new Date(now.getTime() - config.liveGraceMinutes * 60_000);
  for (const t of due) {
    const open = await db.query<SlotRow>('SELECT * FROM tournament_matches WHERE tournament_id = $1 AND round = $2 AND winner IS NULL', [t.id, t.round]);
    for (const m of open) {
      if (m.live_started_at && new Date(m.live_started_at) > grace) continue;
      const winner = await simulateSlot(db, ctx, t, m);
      await db.query("UPDATE tournament_matches SET winner = $4, how = 'simulated' WHERE tournament_id = $1 AND round = $2 AND slot = $3 AND winner IS NULL", [
        t.id,
        m.round,
        m.slot,
        winner,
      ]);
    }
    await advanceTournament(db, t.id, config, now);
  }
}

async function simulateSlot(db: Db, ctx: MatchContext, t: TournamentRow, m: SlotRow): Promise<string> {
  const a = m.player_a!;
  const b = m.player_b!;
  const prefix = `${t.seed}:r${m.round}:s${m.slot}`;
  const decks = await db.query<{ user_id: string; leader_id: string; card_ids: string[] }>(
    'SELECT user_id, leader_id, card_ids FROM tournament_players WHERE tournament_id = $1 AND user_id = ANY($2)',
    [t.id, [a, b]],
  );
  const deckOf = (id: string) => decks.find((d) => d.user_id === id);
  const da = deckOf(a);
  const db_ = deckOf(b);
  try {
    if (da && db_) {
      const r = simulateMatchup(ctx, { leader: da.leader_id, deck: da.card_ids }, { leader: db_.leader_id, deck: db_.card_ids }, 1, prefix);
      if (r.winsA) return a;
      if (r.winsB) return b;
    }
  } catch {
    // Deck devenu injouable (carte retirée du catalogue) : pile ou face.
  }
  return Rng.fromSeed(`${prefix}:coin`).int(2) === 0 ? a : b;
}

/** Classement, récompenses et titre du champion. */
async function finishTournament(db: Db, t: TournamentRow, config: TournamentConfig, now: Date): Promise<void> {
  const rows = await db.query<SlotRow>('SELECT * FROM tournament_matches WHERE tournament_id = $1', [t.id]);
  const top = new Map<string, number>();
  for (const r of rows) {
    if (r.how === 'bye' || !r.winner) continue;
    const loser = r.winner === r.player_a ? r.player_b : r.player_a;
    if (loser) top.set(loser, 2 ** (t.rounds - r.round + 1));
  }
  const champion = rows.find((r) => r.round === t.rounds)?.winner ?? null;
  if (champion) top.set(champion, 1);
  const tiers = config.rewards.filter((r) => r.top > 0).sort((x, y) => x.top - y.top);
  const participation = config.rewards.find((r) => r.top === 0) ?? { coins: 0, freeBoosters: 0 };
  await db.transaction(async (tx) => {
    const ended = await tx.query("UPDATE tournaments SET status = 'done', ended_at = $2 WHERE id = $1 AND status = 'running' RETURNING 1", [t.id, now]);
    if (ended.length === 0) return;
    const players = await tx.query<{ user_id: string }>('SELECT user_id FROM tournament_players WHERE tournament_id = $1', [t.id]);
    for (const { user_id } of players) {
      const place = top.get(user_id) ?? 2 ** t.rounds;
      const reward = tiers.find((r) => place <= r.top) ?? participation;
      await tx.query('UPDATE tournament_players SET top = $3, reward_coins = $4, reward_boosters = $5 WHERE tournament_id = $1 AND user_id = $2', [
        t.id,
        user_id,
        place,
        reward.coins,
        reward.freeBoosters,
      ]);
      await tx.query('UPDATE wallets SET coins = coins + $2, free_boosters = free_boosters + $3 WHERE user_id = $1', [user_id, reward.coins, reward.freeBoosters]);
      if (reward.coins) await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'coins', $2, 'tournament', $3)", [user_id, reward.coins, t.id]);
      if (reward.freeBoosters)
        await tx.query("INSERT INTO coin_ledger (user_id, currency, amount, reason, ref) VALUES ($1, 'free_boosters', $2, 'tournament', $3)", [user_id, reward.freeBoosters, t.id]);
    }
    if (champion) {
      await tx.query('INSERT INTO user_titles (user_id, title_id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
        champion,
        `tournament_${t.start_date}`,
        JSON.stringify(config.championTitle),
      ]);
    }
  });
}

export interface TournamentPairing {
  tournamentId: string;
  round: number;
  slot: number;
  key: string;
  me: { leader: string; cards: string[] };
}

/** Match à jouer maintenant (tour en cours, adversaire connu, pas encore tranché). */
export async function pendingTournamentMatch(db: Db, userId: string): Promise<TournamentPairing | null> {
  const [row] = await db.query<{ tournament_id: string; round: number; slot: number; leader_id: string; card_ids: string[] }>(
    `SELECT m.tournament_id, m.round, m.slot, p.leader_id, p.card_ids
     FROM tournaments t JOIN tournament_matches m ON m.tournament_id = t.id AND m.round = t.round
     JOIN tournament_players p ON p.tournament_id = t.id AND p.user_id = $1
     WHERE t.status = 'running' AND m.winner IS NULL AND m.player_a IS NOT NULL AND m.player_b IS NOT NULL AND (m.player_a = $1 OR m.player_b = $1)`,
    [userId],
  );
  if (!row) return null;
  return {
    tournamentId: row.tournament_id,
    round: row.round,
    slot: row.slot,
    key: `${row.tournament_id}:${row.round}:${row.slot}`,
    me: { leader: row.leader_id, cards: row.card_ids },
  };
}

export async function markLiveStart(db: Db, p: Pick<TournamentPairing, 'tournamentId' | 'round' | 'slot'>, matchId: string, now = new Date()): Promise<void> {
  await db.query('UPDATE tournament_matches SET match_id = $4, live_started_at = $5 WHERE tournament_id = $1 AND round = $2 AND slot = $3 AND winner IS NULL', [
    p.tournamentId,
    p.round,
    p.slot,
    matchId,
    now,
  ]);
}

/** Fin d'un match joué en direct : vainqueur enregistré, ou nul à rejouer. */
export async function recordTournamentMatch(
  db: Db,
  p: Pick<TournamentPairing, 'tournamentId' | 'round' | 'slot'>,
  winner: string | null,
  config: TournamentConfig,
  now = new Date(),
): Promise<void> {
  if (!winner) {
    await db.query('UPDATE tournament_matches SET match_id = NULL, live_started_at = NULL WHERE tournament_id = $1 AND round = $2 AND slot = $3 AND winner IS NULL', [
      p.tournamentId,
      p.round,
      p.slot,
    ]);
    return;
  }
  await db.query("UPDATE tournament_matches SET winner = $4, how = 'played' WHERE tournament_id = $1 AND round = $2 AND slot = $3 AND winner IS NULL", [
    p.tournamentId,
    p.round,
    p.slot,
    winner,
  ]);
  await advanceTournament(db, p.tournamentId, config, now);
}

async function toDto(db: Db, t: TournamentRow, userId: string): Promise<TournamentDto> {
  const players = await db.query<{ user_id: string; display_name: string; leader_id: string; card_ids: string[]; top: number | null; reward_coins: number | null; reward_boosters: number | null }>(
    `SELECT p.user_id, u.display_name, p.leader_id, p.card_ids, p.top, p.reward_coins, p.reward_boosters
     FROM tournament_players p JOIN users u ON u.id = p.user_id WHERE p.tournament_id = $1`,
    [t.id],
  );
  const byId = new Map(players.map((p) => [p.user_id, p]));
  const me = byId.get(userId);
  const rows = await db.query<SlotRow>('SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY round, slot', [t.id]);
  const side = (id: string | null) => {
    const p = id ? byId.get(id) : undefined;
    return p ? { name: p.display_name, leader: p.leader_id, you: p.user_id === userId } : null;
  };
  const bracket: TournamentSlotDto[][] = [];
  for (const r of rows) {
    (bracket[r.round - 1] ??= []).push({
      slot: r.slot,
      a: side(r.player_a),
      b: side(r.player_b),
      winner: r.winner === null ? null : r.winner === r.player_a ? 'a' : 'b',
      how: r.how,
    });
  }
  const mine = rows.find((r) => r.round === t.round && !r.winner && r.player_a && r.player_b && (r.player_a === userId || r.player_b === userId));
  const opponent = mine ? byId.get(mine.player_a === userId ? mine.player_b! : mine.player_a!) : undefined;
  return {
    id: t.id,
    startDate: t.start_date,
    startsAt: iso(t.starts_at)!,
    status: t.status,
    round: t.round,
    rounds: t.rounds,
    roundEndsAt: iso(t.round_ends_at),
    players: players.length,
    registered: me ? { leader: me.leader_id, cards: me.card_ids.length } : null,
    bracket,
    myMatch: mine && opponent ? { round: mine.round, opponent: opponent.display_name, opponentLeader: opponent.leader_id, live: !!mine.live_started_at } : null,
    result: me?.top ? { top: me.top, reward: { coins: me.reward_coins ?? 0, freeBoosters: me.reward_boosters ?? 0 } } : null,
  };
}

export async function getTournaments(db: Db, userId: string, config: TournamentConfig, now = new Date()): Promise<TournamentsDto> {
  const next = await registeringTournament(db, config, now);
  // Tournoi en cours, sinon le dernier terminé (moins de 7 jours).
  const [current] = await db.query<TournamentRow>(
    `SELECT * FROM tournaments WHERE id <> $1 AND (status IN ('running', 'registering') AND starts_at <= $2 OR status IN ('done', 'cancelled') AND ended_at > $3)
     ORDER BY starts_at DESC LIMIT 1`,
    [next.id, now, new Date(now.getTime() - 7 * 86_400_000)],
  );
  return {
    next: await toDto(db, next, userId),
    current: current ? await toDto(db, current, userId) : null,
    roundHours: config.roundHours,
    rewards: config.rewards.map((r) => ({ top: r.top, coins: r.coins, freeBoosters: r.freeBoosters })),
  };
}

/** Ordonnanceur : début des tournois et échéances des tours (une vérification par minute). */
export class TournamentScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly config: TournamentConfig,
    private readonly catalog: () => CatalogSnapshot,
    private readonly log: (msg: string, err?: unknown) => void,
  ) {}

  start(): void {
    void this.tick(new Date());
    this.timer = setInterval(() => void this.tick(new Date()), 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now: Date): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await startDueTournaments(this.db, this.config, now);
      await resolveDueRounds(this.db, this.catalog().ctx, this.config, now);
    } catch (err) {
      this.log('Tournoi : échec, nouvel essai dans une minute.', err);
    } finally {
      this.running = false;
    }
  }
}
