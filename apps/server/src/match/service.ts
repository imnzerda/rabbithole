import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { EngineError, validateDeck, type GameAction } from '@rabbithole/engine';
import type { QueueMode } from '@rabbithole/shared';
import type { User } from '../auth/accounts.js';
import { referenceDecks } from '../decks/reference.js';
import { checkDeck, getDeck } from '../decks/decks.js';
import type { CategoryId } from '@rabbithole/engine';
import { awardMatchCoins } from '../economy/economy.js';
import { recordMissionSafe } from '../retention/missions.js';
import { addPassXpSafe, playerCosmetics } from '../retention/pass.js';
import { applyRankedResult } from '../ranked/ranked.js';
import { activeTrending } from '../trending/trending.js';
import { dailyChallenge, dailyKey, hasPlayedDaily, recordDaily } from '../retention/daily.js';
import { draftDeck, recentDraftDecks, recordDraftResult } from '../retention/draft.js';
import { markLiveStart, pendingTournamentMatch, recordTournamentMatch } from '../tournament/tournament.js';
import { addGuildXpSafe, guildCoinBonus } from '../guilds/guilds.js';
import type { RankedResultDto } from '@rabbithole/shared';
import type { AppDeps } from '../deps.js';
import { contentFilterFor } from '../moderation/filter.js';
import { MatchRoom, type Send, type SeatInfo } from './room.js';

interface QueueEntry {
  userId: string;
  name: string;
  mode: QueueMode;
  /** Appariement imposé (tournoi : les deux joueurs du même match) ; absent = n'importe qui de la même file. */
  key?: string;
  seat: SeatInfo;
  ghostTimer: ReturnType<typeof setTimeout> | null;
}

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Matchmaking et parties en cours (mémoire d'un seul serveur).
 * En production multi-instances, la file passera par Redis (phase 8).
 */
export class MatchService {
  private readonly rooms = new Map<string, MatchRoom>();
  private readonly roomOfUser = new Map<string, string>();
  private readonly queue: QueueEntry[] = [];
  private readonly sends = new Map<string, Send>();
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly deps: AppDeps) {}

  /** Catalogue courant : une partie garde celui de son démarrage, même si l'admin publie entre-temps. */
  private get ctx() {
    return this.deps.catalog.current.ctx;
  }

  private get timers() {
    const { config } = this.deps;
    return {
      turnMs: config.turnTimerMs ?? this.ctx.rules.turnTimerSeconds * 1000,
      reactionMs: config.reactionTimerMs ?? this.ctx.rules.reactionTimerSeconds * 1000,
    };
  }

  /** Nouvelle connexion : si le joueur a une partie en cours, on la lui renvoie. */
  connect(user: User, send: Send): void {
    this.sends.set(user.id, send);
    send({ t: 'hello', user: { id: user.id, displayName: user.displayName } });
    const room = this.roomFor(user.id);
    if (room) room.attach(user.id, send);
  }

  disconnect(user: User, send: Send): void {
    if (this.sends.get(user.id) === send) this.sends.delete(user.id);
    this.roomFor(user.id)?.detach(user.id, send);
    // Un joueur déconnecté sort de la file ; une partie en cours continue (minuteurs).
    this.leaveQueue(user.id);
  }

  roomFor(userId: string): MatchRoom | null {
    const id = this.roomOfUser.get(userId);
    return id ? (this.rooms.get(id) ?? null) : null;
  }

  async enqueue(user: User, deckId: string, mode: QueueMode): Promise<void> {
    if (this.roomFor(user.id)) throw new ServiceError('already_in_match', 'Tu as déjà une partie en cours.');
    this.leaveQueue(user.id);
    const deck = await getDeck(this.deps.db, user.id, deckId);
    if (!deck) throw new ServiceError('deck_not_found', 'Deck introuvable.');
    const errors = await checkDeck(this.deps.db, this.ctx, user.id, deck.leaderId, deck.cardIds, (await contentFilterFor(this.deps.db, user, this.deps.catalog.current)).blocked);
    if (errors.length) throw new ServiceError('invalid_deck', errors.join(' '));
    const seat: SeatInfo = { userId: user.id, name: user.displayName, leader: deck.leaderId, deck: deck.cardIds, cosmetics: await playerCosmetics(this.deps.db, user.id) };
    await this.queueSeat(user, seat, mode);
  }

  /** Draft du week-end : partie avec le deck du draft en cours, contre un autre joueur en draft ou un fantôme. */
  async enqueueDraft(user: User): Promise<void> {
    if (this.roomFor(user.id)) throw new ServiceError('already_in_match', 'Tu as déjà une partie en cours.');
    this.leaveQueue(user.id);
    const draft = await draftDeck(this.deps.db, user.id);
    if (!draft) throw new ServiceError('no_draft', "Pas de draft prêt à jouer.");
    const errors = validateDeck(this.ctx, draft.leader, draft.cards);
    if (errors.length) throw new ServiceError('invalid_deck', errors.join(' '));
    const seat: SeatInfo = {
      userId: user.id,
      name: user.displayName,
      leader: draft.leader,
      deck: draft.cards,
      cosmetics: await playerCosmetics(this.deps.db, user.id),
      draftRun: draft.runId,
    };
    await this.queueSeat(user, seat, 'draft');
  }

  /** Tournoi : match du tour en cours, contre l'adversaire désigné (attente sans fantôme ; échéance : simulation). */
  async enqueueTournament(user: User): Promise<void> {
    if (this.roomFor(user.id)) throw new ServiceError('already_in_match', 'Tu as déjà une partie en cours.');
    this.leaveQueue(user.id);
    const pairing = await pendingTournamentMatch(this.deps.db, user.id);
    if (!pairing) throw new ServiceError('no_tournament_match', 'Pas de match de tournoi à jouer.');
    const tournament = { tournamentId: pairing.tournamentId, round: pairing.round, slot: pairing.slot };
    const seat: SeatInfo = {
      userId: user.id,
      name: user.displayName,
      leader: pairing.me.leader,
      deck: pairing.me.cards,
      cosmetics: await playerCosmetics(this.deps.db, user.id),
      tournament,
    };
    const i = this.queue.findIndex((e) => e.mode === 'tournament' && e.key === pairing.key && e.userId !== user.id);
    if (i >= 0) {
      const [opponent] = this.queue.splice(i, 1);
      const id = await this.startMatch('tournament', [opponent!.seat, seat], false);
      await markLiveStart(this.deps.db, tournament, id);
      return;
    }
    this.queue.push({ userId: user.id, name: user.displayName, mode: 'tournament', key: pairing.key, seat, ghostTimer: null });
    this.sends.get(user.id)?.({ t: 'queued', mode: 'tournament', ghostInMs: null });
  }

  private async queueSeat(user: User, seat: SeatInfo, mode: QueueMode): Promise<void> {
    if (mode === 'ghost') {
      await this.startGhostMatch(seat, mode);
      return;
    }

    const opponentIndex = this.queue.findIndex((e) => e.mode === mode && e.userId !== user.id);
    if (opponentIndex >= 0) {
      const [opponent] = this.queue.splice(opponentIndex, 1);
      if (opponent!.ghostTimer) clearTimeout(opponent!.ghostTimer);
      await this.startMatch(mode, [opponent!.seat, seat], false);
      return;
    }

    const entry: QueueEntry = { userId: user.id, name: user.displayName, mode, seat, ghostTimer: null };
    // Au-delà du délai, un adversaire fantôme prend le relais (section 7 : mode asynchrone).
    entry.ghostTimer = setTimeout(() => {
      const i = this.queue.indexOf(entry);
      if (i < 0) return;
      this.queue.splice(i, 1);
      this.track(this.startGhostMatch(seat, mode).catch((e: unknown) => this.sends.get(seat.userId!)?.({ t: 'error', code: 'ghost_failed', message: String(e) })));
    }, this.deps.config.ghostDelayMs);
    this.queue.push(entry);
    this.sends.get(user.id)?.({ t: 'queued', mode, ghostInMs: this.deps.config.ghostDelayMs });
  }

  leaveQueue(userId: string): boolean {
    const i = this.queue.findIndex((e) => e.userId === userId);
    if (i < 0) return false;
    const [entry] = this.queue.splice(i, 1);
    if (entry!.ghostTimer) clearTimeout(entry!.ghostTimer);
    return true;
  }

  act(user: User, action: GameAction): void {
    const room = this.roomFor(user.id);
    if (!room) throw new ServiceError('no_match', "Tu n'as pas de partie en cours.");
    room.act(user.id, action);
  }

  /** Fantôme : le deck enregistré d'un autre joueur, piloté par l'IA (repli : un deck de référence de la série, puis du prototype). */
  private async startGhostMatch(seat: SeatInfo, mode: QueueMode): Promise<void> {
    if (mode === 'draft') {
      // Draft : le deck de draft d'un autre joueur, sinon un deck de référence.
      const drafts = (await recentDraftDecks(this.deps.db, seat.userId!, this.ctx.rules.deckSize)).filter((d) => validateDeck(this.ctx, d.leader, d.cards).length === 0);
      if (drafts.length) {
        const pick = drafts[randomInt(drafts.length)]!;
        await this.startMatch(mode, [seat, { userId: null, name: pick.name, leader: pick.leader, deck: pick.cards, cosmetics: await playerCosmetics(this.deps.db, pick.userId) }], true);
        return;
      }
    }
    const candidates = await this.deps.db.query<{ user_id: string; leader_id: string; card_ids: string[]; display_name: string }>(
      `SELECT d.user_id, d.leader_id, d.card_ids, u.display_name FROM decks d JOIN users u ON u.id = d.user_id
       WHERE d.user_id <> $1 ORDER BY d.updated_at DESC LIMIT 50`,
      [seat.userId],
    );
    const valid = mode === 'draft' ? [] : candidates.filter((c) => validateDeck(this.ctx, c.leader_id, c.card_ids).length === 0);
    let ghost: SeatInfo;
    if (valid.length) {
      const pick = valid[randomInt(valid.length)]!;
      ghost = { userId: null, name: pick.display_name, leader: pick.leader_id, deck: pick.card_ids, cosmetics: await playerCosmetics(this.deps.db, pick.user_id) };
    } else {
      const refs = await referenceDecks(this.deps.db, this.ctx);
      const series = refs.filter((d) => d.series !== 'prototype');
      const fallback = series.length ? series : refs;
      if (!fallback.length) throw new ServiceError('no_ghost', 'Aucun adversaire disponible.');
      const pick = fallback[randomInt(fallback.length)]!;
      ghost = { userId: null, name: 'RABBIT HOLE', leader: pick.leader, deck: pick.cards };
    }
    await this.startMatch(mode, [seat, ghost], true);
  }

  /**
   * Défi du jour : deck imposé contre l'IA, même seed pour tous (partie identique à coups identiques).
   * Une seule tentative comptée par jour ; le deck imposé n'a pas à être possédé.
   */
  async startDaily(user: User): Promise<void> {
    if (this.roomFor(user.id)) throw new ServiceError('already_in_match', 'Tu as déjà une partie en cours.');
    if (await hasPlayedDaily(this.deps.db, user.id)) throw new ServiceError('daily_done', 'Tu as déjà joué le défi du jour.');
    const challenge = await dailyChallenge(this.deps.db, this.ctx);
    if (!challenge) throw new ServiceError('no_daily', 'Pas de défi disponible.');
    this.leaveQueue(user.id);
    const seat: SeatInfo = { userId: user.id, name: user.displayName, leader: challenge.deck.leader, deck: challenge.deck.cards, cosmetics: await playerCosmetics(this.deps.db, user.id) };
    const ai: SeatInfo = { userId: null, name: challenge.opponent.name.fr ?? 'RABBIT HOLE', leader: challenge.opponent.leader, deck: challenge.opponent.cards };
    await this.startMatch('daily', [seat, ai], true, challenge.seed);
  }

  private async startMatch(mode: QueueMode, seats: [SeatInfo, SeatInfo], ghost: boolean, fixedSeed?: string): Promise<string> {
    const id = randomUUID();
    // Seed issue du RNG cryptographique du serveur (ou celle du défi du jour), enregistrée pour l'audit et les replays.
    const seed = fixedSeed ?? randomBytes(16).toString('hex');
    const { version, ctx } = this.deps.catalog.current;
    // Tendance du jour : bonus des cartes en tendance, enregistré pour rejouer la partie à l'identique.
    const trending = (await activeTrending(this.deps.db).catch(() => [] as string[])).filter((cardId) => ctx.cards[cardId]);
    await this.deps.db.query(
      `INSERT INTO matches (id, mode, player_a, player_b, ghost, players, seed, content_version, trending)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, mode, seats[0].userId, seats[1].userId, ghost, JSON.stringify(seats), seed, version, trending],
    );
    const room = new MatchRoom({ id, mode, seed, ctx, contentVersion: version, seats, trending, timers: this.timers, onEnd: (r) => this.track(this.onEnd(r)) });
    this.rooms.set(id, room);
    for (const s of seats) {
      if (!s.userId) continue;
      this.roomOfUser.set(s.userId, id);
      const send = this.sends.get(s.userId);
      if (send) room.attach(s.userId, send);
    }
    room.start();
    return id;
  }

  private async onEnd(room: MatchRoom): Promise<void> {
    const result = room.state.result!;
    // Pièces de fin de partie (plafonnées par jour), pour les joueurs humains uniquement.
    const { rewards: table } = this.deps.config.economy;
    const rewards: [number | null, number | null] = [null, null];
    const ranked: [RankedResultDto | null, RankedResultDto | null] = [null, null];
    for (const p of [0, 1] as const) {
      const userId = room.seats[p].userId;
      if (!userId) continue;
      if (room.mode === 'daily') {
        // Défi du jour : score et récompense du défi (première tentative du jour seulement).
        const opponentLeader = room.seats[p === 0 ? 1 : 0].leader;
        rewards[p] = await recordDaily(this.deps.db, userId, dailyKey(), room.id, result, p, this.ctx.cards[opponentLeader]?.life ?? 5, this.deps.config.daily).catch(() => null);
      } else if (room.mode === 'tournament') {
        // Tournoi : pas de pièces par partie ; récompenses au classement final.
        rewards[p] = null;
      } else if (room.mode === 'draft') {
        // Draft : pas de pièces par partie ; la récompense tombe à la fin du draft (dernière partie).
        const run = room.seats[p].draftRun;
        const reward = run ? await recordDraftResult(this.deps.db, userId, run, result.winner === p, this.deps.config.draft).catch(() => null) : null;
        rewards[p] = reward ? reward.coins : null;
      } else {
        // Bonus de pièces de la guilde du joueur (niveau de guilde).
        const base = result.winner === null ? table.draw : result.winner === p ? table.win : table.loss;
        const bonus = await guildCoinBonus(this.deps.db, userId, this.deps.config.guilds).catch(() => 0);
        const amount = Math.round(base * (1 + bonus / 100));
        rewards[p] = await awardMatchCoins(this.deps.db, userId, amount, room.id, this.deps.config.economy);
      }
      await this.recordMissions(room, p, userId);
      // XP de guilde : toute partie en ligne d'un membre (plafonnée par jour).
      const gx = this.deps.config.guilds.xp;
      await addGuildXpSafe(this.deps.db, userId, result.winner === p ? gx.matchWin : gx.matchLoss, this.deps.config.guilds);
      // Partie classée (contre un fantôme aussi, quand l'attente dépasse le délai) : points de classement.
      if (room.mode === 'ranked') {
        const outcome = result.winner === null ? 'draw' : result.winner === p ? 'win' : 'loss';
        ranked[p] = await applyRankedResult(this.deps.db, userId, outcome, result.stake, this.deps.config.ranked).catch(() => null);
      }
    }
    // Tournoi : vainqueur du match (un nul se rejoue), puis tour suivant si le tour est complet.
    const pairing = room.seats[0].tournament;
    if (room.mode === 'tournament' && pairing) {
      const winner = result.winner === null ? null : room.seats[result.winner].userId;
      await recordTournamentMatch(this.deps.db, pairing, winner, this.deps.config.tournament).catch(() => {});
    }
    await this.deps.db.query(`UPDATE matches SET actions = $1, result = $2, rewards = $3, ended_at = now() WHERE id = $4`, [
      JSON.stringify(room.actions),
      JSON.stringify(result),
      JSON.stringify(rewards),
      room.id,
    ]);
    room.announceEnd(rewards, ranked);
    this.rooms.delete(room.id);
    for (const s of room.seats) if (s.userId && this.roomOfUser.get(s.userId) === room.id) this.roomOfUser.delete(s.userId);
  }

  /** Missions (section 13) : partie jouée, victoire, cartes jouées et leurs catégories. */
  private async recordMissions(room: MatchRoom, p: 0 | 1, userId: string): Promise<void> {
    const { db, config } = this.deps;
    const result = room.state.result!;
    await recordMissionSafe(db, userId, 'play', 1, config.missions);
    const xp = config.pass.matchXp;
    await addPassXpSafe(db, userId, result.winner === null ? xp.draw : result.winner === p ? xp.win : xp.loss, config.pass);
    if (result.winner === p) await recordMissionSafe(db, userId, 'win', 1, config.missions);
    const byCategory = new Map<CategoryId, number>();
    let played = 0;
    for (const { player, action } of room.actions) {
      if (player !== p || action.type !== 'play') continue;
      const def = room.ctx.cards[room.state.cards[action.uid]?.defId ?? ''];
      if (!def) continue;
      played++;
      for (const c of def.categories) byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
    }
    await recordMissionSafe(db, userId, 'play_cards', played, config.missions);
    for (const [category, n] of byCategory) await recordMissionSafe(db, userId, 'play_category', n, config.missions, category);
  }

  private track(p: Promise<unknown>): void {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** Attend les écritures en cours (tests, arrêt propre). */
  async flush(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  async close(): Promise<void> {
    for (const e of this.queue) if (e.ghostTimer) clearTimeout(e.ghostTimer);
    this.queue.length = 0;
    for (const room of this.rooms.values()) room.dispose();
    await this.flush();
  }

  /** Message d'erreur lisible pour le client (sans détail interne). */
  static describe(error: unknown): { code: string; message: string } {
    if (error instanceof ServiceError) return { code: error.code, message: error.message };
    if (error instanceof EngineError) return { code: error.code, message: error.message };
    return { code: 'internal', message: 'Erreur interne.' };
  }
}
