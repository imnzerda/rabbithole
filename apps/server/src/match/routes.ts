import type { FastifyInstance } from 'fastify';
import type { GameAction, MatchResult, PlayerIndex } from '@rabbithole/engine';
import type { ClientMessage, MatchSummary, QueueMode, ReplayData, ServerMessage } from '@rabbithole/shared';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import type { AppDeps } from '../deps.js';
import type { SeatInfo } from './room.js';
import { MatchService } from './service.js';

const uid = z.string().min(1).max(40);

/** Forme des actions de jeu (le moteur en vérifie ensuite la légalité). */
const actionSchema: z.ZodType<GameAction> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mulligan'), redraw: z.boolean() }),
  z.object({ type: z.literal('play'), uid }),
  z.object({ type: z.literal('attach'), target: uid, amount: z.number().int().min(1).max(10).optional() }),
  z.object({ type: z.literal('attack'), attacker: uid, target: uid }),
  z.object({ type: z.literal('activate'), uid }),
  z.object({ type: z.literal('end_turn') }),
  z.object({ type: z.literal('block'), blocker: uid.nullable() }),
  z.object({ type: z.literal('counter'), uids: z.array(uid).max(20) }),
  z.object({ type: z.literal('trigger'), activate: z.boolean() }),
  z.object({ type: z.literal('hype') }),
  z.object({ type: z.literal('fold') }),
]);

const modeSchema = z.enum(['casual', 'ranked', 'ghost']);

const clientMessageSchema: z.ZodType<ClientMessage> = z.discriminatedUnion('t', [
  z.object({ t: z.literal('queue'), deckId: z.string().uuid(), mode: modeSchema }),
  z.object({ t: z.literal('cancel') }),
  z.object({ t: z.literal('action'), action: actionSchema }),
  z.object({ t: z.literal('resume') }),
  z.object({ t: z.literal('daily') }),
]);

interface MatchRow {
  id: string;
  mode: QueueMode;
  player_a: string | null;
  player_b: string | null;
  ghost: boolean;
  players: (SeatInfo & { userId: string | null })[];
  seed: string;
  content_version: string;
  actions: { player: PlayerIndex; action: GameAction }[];
  trending: string[] | null;
  result: MatchResult | null;
  created_at: string | Date;
}

const iso = (d: string | Date) => (d instanceof Date ? d.toISOString() : String(d));

export function registerMatches(app: FastifyInstance, deps: AppDeps, service: MatchService): void {
  // --- Temps réel : matchmaking et actions de jeu.
  app.get('/ws', { websocket: true }, (socket, request) => {
    const user = request.user;
    if (!user) {
      socket.close(4401, 'unauthorized');
      return;
    }
    const send = (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const fail = (error: unknown) => send({ t: 'error', ...MatchService.describe(error) });
    service.connect(user, send);

    socket.on('message', (raw: Buffer) => {
      let message: ClientMessage;
      try {
        const parsed = clientMessageSchema.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) return send({ t: 'error', code: 'invalid_message', message: 'Message invalide.' });
        message = parsed.data;
      } catch {
        return send({ t: 'error', code: 'invalid_message', message: 'JSON invalide.' });
      }
      try {
        switch (message.t) {
          case 'queue':
            service.enqueue(user, message.deckId, message.mode).catch(fail);
            break;
          case 'daily':
            service.startDaily(user).catch(fail);
            break;
          case 'cancel':
            service.leaveQueue(user.id);
            send({ t: 'cancelled' });
            break;
          case 'action':
            service.act(user, message.action);
            break;
          case 'resume':
            service.roomFor(user.id)?.attach(user.id, send);
            break;
        }
      } catch (error) {
        fail(error);
      }
    });
    socket.on('close', () => service.disconnect(user, send));
  });

  // --- Historique et replays (participants uniquement, parties terminées).
  app.get('/api/matches', { preHandler: requireUser }, async (request) => {
    const me = request.user!.id;
    const rows = await deps.db.query<MatchRow>(
      `SELECT * FROM matches WHERE (player_a = $1 OR player_b = $1) AND ended_at IS NOT NULL ORDER BY created_at DESC LIMIT 50`,
      [me],
    );
    const matches: MatchSummary[] = rows.map((r) => {
      const you: PlayerIndex = r.player_a === me ? 0 : 1;
      const opponent = r.players[you === 0 ? 1 : 0]!;
      return { id: r.id, mode: r.mode, you, opponent: opponent.name, ghost: r.ghost, result: r.result!, createdAt: iso(r.created_at) };
    });
    return { matches };
  });

  app.get('/api/replays/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = z.string().uuid().safeParse((request.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' });
    const [row] = await deps.db.query<MatchRow>('SELECT * FROM matches WHERE id = $1 AND ended_at IS NOT NULL', [id.data]);
    const me = request.user!.id;
    if (!row || (row.player_a !== me && row.player_b !== me)) return reply.code(404).send({ error: 'not_found' });
    const replay: ReplayData = {
      id: row.id,
      you: row.player_a === me ? 0 : 1,
      mode: row.mode,
      contentVersion: row.content_version,
      seed: row.seed,
      players: row.players.map((p) => ({ name: p.name, leader: p.leader, deck: p.deck, ghost: p.userId === null })) as ReplayData['players'],
      actions: row.actions,
      trending: row.trending ?? [],
      result: row.result!,
      createdAt: iso(row.created_at),
    };
    return { replay };
  });
}
