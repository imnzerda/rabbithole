import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import type { AppDeps } from '../deps.js';
import {
  cancelJoinRequest,
  createGuild,
  decideRequest,
  GuildError,
  guildSummary,
  joinGuild,
  kickMember,
  leaveGuild,
  myGuild,
  searchGuilds,
  setRole,
  updateGuild,
} from './guilds.js';

/** Guildes : recherche, création, adhésion, départ, rôles, réglages. */
export function registerGuilds(app: FastifyInstance, { db, config }: AppDeps): void {
  const cfg = config.guilds;
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof GuildError) return reply.code(error.status).send({ error: error.code });
    throw error;
  };
  const settings = z.object({
    description: z.string().max(200),
    emblem: z.string().min(1).max(40),
    language: z.string().min(2).max(5),
    open: z.boolean(),
  });
  const uuid = z.string().uuid();
  const param = (params: unknown, key: string) => uuid.safeParse((params as Record<string, unknown>)[key]);
  const me = (userId: string) => myGuild(db, userId, cfg);

  app.get('/api/guilds/me', { preHandler: requireUser }, async (request) => me(request.user!.id));

  app.get('/api/guilds', { preHandler: requireUser }, async (request, reply) => {
    const query = z.object({ q: z.string().max(40).optional(), lang: z.string().max(5).optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_input' });
    return { guilds: await searchGuilds(db, query.data.q ?? '', query.data.lang || null, cfg) };
  });

  app.get('/api/guilds/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = param(request.params, 'id');
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' });
    const guild = await guildSummary(db, id.data, cfg);
    return guild ? { guild } : reply.code(404).send({ error: 'guild_not_found' });
  });

  app.post('/api/guilds', { preHandler: requireUser }, async (request, reply) => {
    const body = settings.extend({ name: z.string().trim().min(3).max(24) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const { name, ...rest } = body.data;
      await createGuild(db, request.user!.id, name, rest, cfg);
      return me(request.user!.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/guilds/:id/join', { preHandler: requireUser }, async (request, reply) => {
    const id = param(request.params, 'id');
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const status = await joinGuild(db, request.user!.id, id.data, cfg);
      return { status, ...(await me(request.user!.id)) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/guilds/:id/cancel', { preHandler: requireUser }, async (request, reply) => {
    const id = param(request.params, 'id');
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' });
    await cancelJoinRequest(db, request.user!.id, id.data);
    return me(request.user!.id);
  });

  app.post('/api/guilds/leave', { preHandler: requireUser }, async (request, reply) => {
    try {
      await leaveGuild(db, request.user!.id);
      return me(request.user!.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/guilds/requests/:userId', { preHandler: requireUser }, async (request, reply) => {
    const target = param(request.params, 'userId');
    const body = z.object({ accept: z.boolean() }).safeParse(request.body);
    if (!target.success || !body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await decideRequest(db, request.user!.id, target.data, body.data.accept, cfg);
      return me(request.user!.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/guilds/members/:userId/role', { preHandler: requireUser }, async (request, reply) => {
    const target = param(request.params, 'userId');
    const body = z.object({ role: z.enum(['leader', 'officer', 'member']) }).safeParse(request.body);
    if (!target.success || !body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await setRole(db, request.user!.id, target.data, body.data.role);
      return me(request.user!.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/guilds/members/:userId/kick', { preHandler: requireUser }, async (request, reply) => {
    const target = param(request.params, 'userId');
    if (!target.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await kickMember(db, request.user!.id, target.data);
      return me(request.user!.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/guilds/settings', { preHandler: requireUser }, async (request, reply) => {
    const body = settings.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await updateGuild(db, request.user!.id, body.data, cfg);
      return me(request.user!.id);
    } catch (error) {
      return fail(reply, error);
    }
  });
}
