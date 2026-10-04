import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import type { AppDeps } from '../deps.js';
import { EconomyError } from '../economy/economy.js';
import { contentFilterFor } from '../moderation/filter.js';
import { getTournaments, registerTournament, resolveDueRounds, startDueTournaments, unregisterTournament } from './tournament.js';

/** Tournoi hebdomadaire : état (inscriptions, tableau, mon match, résultat), inscription et désinscription. */
export function registerTournaments(app: FastifyInstance, { db, config, catalog }: AppDeps): void {
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof EconomyError) return reply.code(error.status).send({ error: error.code });
    throw error;
  };

  app.get('/api/tournaments', { preHandler: requireUser }, async (request) => getTournaments(db, request.user!.id, config.tournament));

  app.post('/api/tournaments/register', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ deckId: z.string().uuid() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const { blocked } = await contentFilterFor(db, request.user!, catalog.current);
      await registerTournament(db, request.user!, body.data.deckId, catalog.current.ctx, blocked, config.tournament);
      return getTournaments(db, request.user!.id, config.tournament);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/tournaments/unregister', { preHandler: requireUser }, async (request) => {
    await unregisterTournament(db, request.user!.id, config.tournament);
    return getTournaments(db, request.user!.id, config.tournament);
  });

  // Tests automatisés uniquement (interdit en production par la config) : passage du temps simulé.
  if (config.testFixtures) {
    app.post('/api/test/tournament-tick', { preHandler: requireUser }, async (request, reply) => {
      const body = z.object({ at: z.string().datetime() }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
      const now = new Date(body.data.at);
      await startDueTournaments(db, config.tournament, now);
      await resolveDueRounds(db, catalog.current.ctx, config.tournament, now);
      return { ok: true };
    });
  }
}
