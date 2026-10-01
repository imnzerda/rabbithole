import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import { grantTestKit } from '../content.js';
import type { AppDeps } from '../deps.js';
import {
  BOOSTER_TYPES,
  boosterOdds,
  chooseStarterLeader,
  craft,
  EconomyError,
  ensurePreview,
  getWallet,
  isBoosterType,
  openFreeBooster,
  purchasePreview,
  recycle,
} from './economy.js';

const cardId = z.string().min(1).max(80);

export function registerEconomy(app: FastifyInstance, { db, config, catalog }: AppDeps): void {
  const economy = config.economy;
  const cat = () => catalog.current;
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof EconomyError) return reply.code(error.status).send({ error: error.code });
    throw error;
  };
  const typeOf = (params: unknown) => {
    const t = (params as { type?: string }).type ?? '';
    return isBoosterType(t) ? t : null;
  };

  app.get('/api/wallet', { preHandler: requireUser }, async (request) => ({ wallet: await getWallet(db, request.user!.id) }));

  /** Boutique de boosters : aperçu exact de chaque type, prix, minuteur, probabilités affichées. */
  app.get('/api/boosters', { preHandler: requireUser }, async (request) => {
    const userId = request.user!.id;
    const types = await Promise.all(
      Object.entries(BOOSTER_TYPES).map(async ([type, info]) => ({
        type,
        name: info.name,
        price: economy.boosterPrice,
        size: economy.boosterSize,
        refreshHours: economy.previewRefreshHours,
        odds: boosterOdds(type as keyof typeof BOOSTER_TYPES, economy, cat()),
        preview: await ensurePreview(db, userId, type as keyof typeof BOOSTER_TYPES, economy, cat()),
      })),
    );
    return { types, wallet: await getWallet(db, userId), economy: { recycle: economy.recycle, craft: economy.craft, keepCopies: economy.keepCopies } };
  });

  app.post('/api/boosters/:type/purchase', { preHandler: requireUser }, async (request, reply) => {
    const type = typeOf(request.params);
    const body = z.object({ cardIds: z.array(cardId).max(20) }).safeParse(request.body);
    if (!type || !body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const { cards, next } = await purchasePreview(db, request.user!.id, type, body.data.cardIds, economy, cat());
      return { cards, preview: next, wallet: await getWallet(db, request.user!.id) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/boosters/:type/open-free', { preHandler: requireUser }, async (request, reply) => {
    const type = typeOf(request.params);
    if (!type) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const cards = await openFreeBooster(db, request.user!.id, type, economy, cat());
      return { cards, wallet: await getWallet(db, request.user!.id) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/collection/recycle', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ cardId, count: z.number().int().min(1).max(50) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      return { wallet: await recycle(db, request.user!.id, body.data.cardId, body.data.count, economy, cat()) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/collection/craft', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ cardId }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      return { wallet: await craft(db, request.user!.id, body.data.cardId, economy, cat()) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/starter-leader', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ leaderId: cardId }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await chooseStarterLeader(db, request.user!.id, body.data.leaderId, cat());
      return { ok: true };
    } catch (error) {
      return fail(reply, error);
    }
  });

  // Données de test (tests automatisés uniquement, interdit en production par la config).
  if (config.testFixtures) {
    app.post('/api/test/grant-kit', { preHandler: requireUser }, async (request) => {
      await grantTestKit(db, request.user!.id, cat());
      return { ok: true };
    });
  }
}
