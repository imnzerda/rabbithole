import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import type { AppDeps } from '../deps.js';
import { EconomyError } from '../economy/economy.js';
import { catalogForUser } from '../moderation/filter.js';
import { acceptFriend, acceptTrade, closeTrade, friendCollection, listFriends, listTrades, proposeTrade, removeFriend, requestFriend } from './social.js';

const uuid = z.string().uuid();
const cardId = z.string().min(1).max(80);

/** Amis et échanges entre joueurs (section 6.5). */
export function registerSocial(app: FastifyInstance, { db, config, catalog }: AppDeps): void {
  const economy = config.economy;
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof EconomyError) return reply.code(error.status).send({ error: error.code });
    throw error;
  };
  const idOf = (params: unknown) => uuid.safeParse((params as { id?: string }).id);
  /** Catalogues obtenables par les deux joueurs (cartes bloquées dans leurs pays exclues). */
  const catalogsFor = async (me: { country: string }, otherId: string) => {
    const [other] = await db.query<{ country: string }>('SELECT country FROM users WHERE id = $1', [otherId]);
    if (!other) throw new EconomyError('player_not_found', 404);
    return { mine: await catalogForUser(db, me, catalog.current), theirs: await catalogForUser(db, other, catalog.current) };
  };

  app.get('/api/friends', { preHandler: requireUser }, async (request) => listFriends(db, request.user!.id));

  app.post('/api/friends', { preHandler: requireUser }, async (request, reply) => {
    const body = z
      .object({ code: z.string().trim().min(4).max(16).optional(), name: z.string().trim().min(1).max(40).optional() })
      .refine((b) => !!b.code !== !!b.name)
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      return await requestFriend(db, request.user!.id, body.data);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/friends/:id/accept', { preHandler: requireUser }, async (request, reply) => {
    const id = idOf(request.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await acceptFriend(db, request.user!.id, id.data);
      return { ok: true };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete('/api/friends/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = idOf(request.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await removeFriend(db, request.user!.id, id.data);
      return { ok: true };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/friends/:id/collection', { preHandler: requireUser }, async (request, reply) => {
    const id = idOf(request.params);
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      return { cards: await friendCollection(db, request.user!.id, id.data) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/trades', { preHandler: requireUser }, async (request) => ({ ...(await listTrades(db, request.user!.id)), limits: economy.trades }));

  app.post('/api/trades', { preHandler: requireUser }, async (request, reply) => {
    const items = z.array(z.object({ cardId, quantity: z.number().int().min(1).max(100) })).max(50);
    const body = z.object({ toUserId: uuid, offered: items, requested: items }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      return { trade: await proposeTrade(db, request.user!.id, body.data, economy, await catalogsFor(request.user!, body.data.toUserId)) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/trades/:id/:action', { preHandler: requireUser }, async (request, reply) => {
    const id = idOf(request.params);
    const action = z.enum(['accept', 'decline', 'cancel']).safeParse((request.params as { action?: string }).action);
    if (!id.success || !action.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      if (action.data === 'accept') {
        const [t] = await db.query<{ from_user: string }>('SELECT from_user FROM trades WHERE id = $1', [id.data]);
        if (!t) return reply.code(404).send({ error: 'unknown_trade' });
        return { trade: await acceptTrade(db, request.user!.id, id.data, await catalogsFor(request.user!, t.from_user)) };
      }
      await closeTrade(db, request.user!.id, id.data, action.data);
      return { ok: true };
    } catch (error) {
      return fail(reply, error);
    }
  });
}
