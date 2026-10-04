import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import type { AppDeps } from '../deps.js';
import { getRanked, leaderboard } from './ranked.js';

/** Classé (section 7) : mon rang et mes positions, classements mondial et par pays. */
export function registerRanked(app: FastifyInstance, { db, config }: AppDeps): void {
  app.get('/api/ranked', { preHandler: requireUser }, async (request) => getRanked(db, request.user!, config.ranked));

  app.get('/api/ranked/leaderboard', { preHandler: requireUser }, async (request, reply) => {
    const query = z
      .object({ country: z.string().regex(/^([A-Z]{2}|all)$/).default('all'), limit: z.coerce.number().int().min(1).max(1000).default(100) })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_input' });
    const country = query.data.country === 'all' ? null : query.data.country;
    return { entries: await leaderboard(db, request.user!.id, country, query.data.limit, config.ranked) };
  });
}
