import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { EngineError, validateDeck, type GameAction } from '@rabbithole/engine';
import type { QueueMode } from '@rabbithole/shared';
import type { User } from '../auth/accounts.js';
import { PROTOTYPE_DECKS } from '../content.js';
import { checkDeck, getDeck } from '../decks/decks.js';
import { awardMatchCoins } from '../economy/economy.js';
import type { AppDeps } from '../deps.js';
import { MatchRoom, type Send, type SeatInfo } from './room.js';

interface QueueEntry {
  userId: string;
  name: string;
  mode: QueueMode;
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
    const errors = await checkDeck(this.deps.db, this.ctx, user.id, deck.leaderId, deck.cardIds);
    if (errors.length) throw new ServiceError('invalid_deck', errors.join(' '));
    const seat: SeatInfo = { userId: user.id, name: user.displayName, leader: deck.leaderId, deck: deck.cardIds };

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

  /** Fantôme : le deck enregistré d'un autre joueur, piloté par l'IA (repli : un deck préconstruit). */
  private async startGhostMatch(seat: SeatInfo, mode: QueueMode): Promise<void> {
    const candidates = await this.deps.db.query<{ leader_id: string; card_ids: string[]; display_name: string }>(
      `SELECT d.leader_id, d.card_ids, u.display_name FROM decks d JOIN users u ON u.id = d.user_id
       WHERE d.user_id <> $1 ORDER BY d.updated_at DESC LIMIT 50`,
      [seat.userId],
    );
    const valid = candidates.filter((c) => validateDeck(this.ctx, c.leader_id, c.card_ids).length === 0);
    let ghost: SeatInfo;
    if (valid.length) {
      const pick = valid[randomInt(valid.length)]!;
      ghost = { userId: null, name: pick.display_name, leader: pick.leader_id, deck: pick.card_ids };
    } else {
      const fallback = PROTOTYPE_DECKS.filter((d) => validateDeck(this.ctx, d.leader, d.cards).length === 0);
      if (!fallback.length) throw new ServiceError('no_ghost', 'Aucun adversaire disponible.');
      const pick = fallback[randomInt(fallback.length)]!;
      ghost = { userId: null, name: 'RABBIT HOLE', leader: pick.leader, deck: pick.cards };
    }
    await this.startMatch(mode, [seat, ghost], true);
  }

  private async startMatch(mode: QueueMode, seats: [SeatInfo, SeatInfo], ghost: boolean): Promise<void> {
    const id = randomUUID();
    // Seed issue du RNG cryptographique du serveur, enregistrée pour l'audit et les replays.
    const seed = randomBytes(16).toString('hex');
    const { version, ctx } = this.deps.catalog.current;
    await this.deps.db.query(
      `INSERT INTO matches (id, mode, player_a, player_b, ghost, players, seed, content_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, mode, seats[0].userId, seats[1].userId, ghost, JSON.stringify(seats), seed, version],
    );
    const room = new MatchRoom({ id, mode, seed, ctx, contentVersion: version, seats, timers: this.timers, onEnd: (r) => this.track(this.onEnd(r)) });
    this.rooms.set(id, room);
    for (const s of seats) {
      if (!s.userId) continue;
      this.roomOfUser.set(s.userId, id);
      const send = this.sends.get(s.userId);
      if (send) room.attach(s.userId, send);
    }
    room.start();
  }

  private async onEnd(room: MatchRoom): Promise<void> {
    const result = room.state.result!;
    // Pièces de fin de partie (plafonnées par jour), pour les joueurs humains uniquement.
    const { rewards: table } = this.deps.config.economy;
    const rewards: [number | null, number | null] = [null, null];
    for (const p of [0, 1] as const) {
      const userId = room.seats[p].userId;
      if (!userId) continue;
      const amount = result.winner === null ? table.draw : result.winner === p ? table.win : table.loss;
      rewards[p] = await awardMatchCoins(this.deps.db, userId, amount, room.id, this.deps.config.economy);
    }
    await this.deps.db.query(`UPDATE matches SET actions = $1, result = $2, rewards = $3, ended_at = now() WHERE id = $4`, [
      JSON.stringify(room.actions),
      JSON.stringify(result),
      JSON.stringify(rewards),
      room.id,
    ]);
    room.announceEnd(rewards);
    this.rooms.delete(room.id);
    for (const s of room.seats) if (s.userId && this.roomOfUser.get(s.userId) === room.id) this.roomOfUser.delete(s.userId);
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
