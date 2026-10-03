import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import { CARD_VARIANTS } from '../config.js';
import type { AppDeps } from '../deps.js';
import { EconomyError, getWallet } from '../economy/economy.js';
import { listOffers } from '../payments/payments.js';
import { claimMission, listMissions } from './missions.js';
import { addPassXpSafe, claimTier, getPass } from './pass.js';

/** Rétention (phase 6) : missions, pass saisonnier, cosmétiques (titres, variantes de cartes). */
export function registerRetention(app: FastifyInstance, { db, config, catalog }: AppDeps): void {
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof EconomyError) return reply.code(error.status).send({ error: error.code });
    throw error;
  };

  app.get('/api/missions', { preHandler: requireUser }, async (request) => listMissions(db, request.user!.id, config.missions));

  app.post('/api/missions/:id/claim', { preHandler: requireUser }, async (request, reply) => {
    const id = z.string().uuid().safeParse((request.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const reward = await claimMission(db, request.user!.id, id.data);
      await addPassXpSafe(db, request.user!.id, reward.xp, config.pass);
      return { reward, wallet: await getWallet(db, request.user!.id) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** Pass de la saison en cours, avec le prix des pistes payantes (achat direct, pas en gemmes). */
  app.get('/api/pass', { preHandler: requireUser }, async (request) => ({
    pass: await getPass(db, request.user!.id, config.pass, catalog.current),
    offers: config.payments.provider === 'none' ? [] : await listOffers(db, request.user!.country, 'pass'),
  }));

  app.post('/api/pass/claim', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ tier: z.number().int().min(1).max(200), track: z.enum(['free', 'premium', 'deluxe']) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const reward = await claimTier(db, request.user!.id, body.data.tier, body.data.track, config.pass, catalog.current);
      return { reward, wallet: await getWallet(db, request.user!.id) };
    } catch (error) {
      return fail(reply, error);
    }
  });

  /** Cosmétiques possédés : variantes de cartes (une affichée par carte) et titres (un actif). */
  app.get('/api/cosmetics', { preHandler: requireUser }, async (request) => {
    const userId = request.user!.id;
    const variants = await db.query<{ card_id: string; variant: string; equipped: boolean }>(
      'SELECT card_id, variant, equipped FROM user_card_variants WHERE user_id = $1 ORDER BY card_id, variant',
      [userId],
    );
    const titles = await db.query<{ title_id: string; name: Record<string, string> }>('SELECT title_id, name FROM user_titles WHERE user_id = $1 ORDER BY acquired_at', [userId]);
    const [me] = await db.query<{ active_title: string | null }>('SELECT active_title FROM users WHERE id = $1', [userId]);
    return {
      variants: variants.map((v) => ({ cardId: v.card_id, variant: v.variant, equipped: v.equipped })),
      titles: titles.map((x) => ({ id: x.title_id, name: x.name })),
      activeTitle: me?.active_title ?? null,
    };
  });

  /** Variante affichée pour une carte (null : apparence normale). */
  app.post('/api/cosmetics/variant', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ cardId: z.string().min(1).max(80), variant: z.enum(CARD_VARIANTS).nullable() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const { cardId, variant } = body.data;
    return db.transaction(async (tx) => {
      if (variant) {
        const [owned] = await tx.query('SELECT 1 FROM user_card_variants WHERE user_id = $1 AND card_id = $2 AND variant = $3', [request.user!.id, cardId, variant]);
        if (!owned) return reply.code(403).send({ error: 'variant_not_owned' });
      }
      await tx.query('UPDATE user_card_variants SET equipped = (variant = $3) WHERE user_id = $1 AND card_id = $2', [request.user!.id, cardId, variant ?? '']);
      return { ok: true };
    });
  });

  /** Titre affiché sur le profil et en partie (null : aucun). */
  app.post('/api/cosmetics/title', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ titleId: z.string().min(1).max(80).nullable() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (body.data.titleId) {
      const [owned] = await db.query('SELECT 1 FROM user_titles WHERE user_id = $1 AND title_id = $2', [request.user!.id, body.data.titleId]);
      if (!owned) return reply.code(403).send({ error: 'title_not_owned' });
    }
    await db.query('UPDATE users SET active_title = $2 WHERE id = $1', [request.user!.id, body.data.titleId]);
    return { ok: true };
  });
}
