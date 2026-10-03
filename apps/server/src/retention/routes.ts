import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import type { AppDeps } from '../deps.js';
import { EconomyError, getWallet } from '../economy/economy.js';
import { claimMission, listMissions } from './missions.js';

/** Rétention (phase 6) : missions quotidiennes et hebdomadaires. */
export function registerRetention(app: FastifyInstance, { db, config }: AppDeps): void {
  app.get('/api/missions', { preHandler: requireUser }, async (request) => listMissions(db, request.user!.id, config.missions));

  app.post('/api/missions/:id/claim', { preHandler: requireUser }, async (request, reply) => {
    const id = z.string().uuid().safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const reward = await claimMission(db, request.user!.id, id.data);
      return { reward, wallet: await getWallet(db, request.user!.id) };
    } catch (error) {
      if (error instanceof EconomyError) return reply.code(error.status).send({ error: error.code });
      throw error;
    }
  });
}
