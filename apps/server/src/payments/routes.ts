import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import type { AppDeps } from '../deps.js';
import { EconomyError } from '../economy/economy.js';
import { applyEvent, cancelPending, checkout, listOffers, listPurchases, monthSpent, setSpendCap, spendCap } from './payments.js';
import { SandboxProvider, type PaymentProvider } from './provider.js';

/** Boutique, webhooks du prestataire et, en développement, le prestataire sandbox. */
export function registerPayments(app: FastifyInstance, { db, config }: AppDeps): void {
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof EconomyError) return reply.code(error.status).send({ error: error.code });
    throw error;
  };

  // Le prestataire sandbox livre ses webhooks au serveur lui-même, par le même chemin qu'un vrai prestataire.
  const sandbox =
    config.payments.provider === 'sandbox'
      ? new SandboxProvider(config.payments.sandboxSecret, async (payload, headers) => {
          const res = await app.inject({ method: 'POST', url: '/api/webhooks/payment/sandbox', payload, headers });
          if (res.statusCode !== 200) throw new Error(`webhook sandbox refusé : ${res.statusCode}`);
        })
      : null;
  const providers = new Map<string, PaymentProvider>(sandbox ? [[sandbox.name, sandbox]] : []);
  const active = sandbox;

  app.get('/api/shop', { preHandler: requireUser }, async (request) => {
    const offers = await listOffers(db, request.user!.country);
    const currency = offers[0]?.currency ?? 'EUR';
    return {
      enabled: !!active,
      offers,
      currency,
      spendCap: await spendCap(db, request.user!.id),
      monthSpent: await monthSpent(db, request.user!.id, currency),
    };
  });

  app.post('/api/shop/checkout', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ productId: z.string().min(1).max(40), returnPath: z.enum(['/shop', '/pass']).default('/shop') }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!active) return reply.code(503).send({ error: 'shop_closed' });
    try {
      return await checkout(db, active, request.user!, body.data.productId, config.pass, body.data.returnPath);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/purchases', { preHandler: requireUser }, async (request) => ({ purchases: await listPurchases(db, request.user!.id) }));

  /** Plafond de dépense mensuel facultatif, en unité mineure de la devise du joueur ; null pour l'enlever. */
  app.post('/api/me/spend-cap', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ cap: z.number().int().min(0).max(10_000_000).nullable() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    await setSpendCap(db, request.user!.id, body.data.cap);
    return { spendCap: body.data.cap };
  });

  // Webhooks : corps brut indispensable pour vérifier la signature.
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    scope.post('/api/webhooks/payment/:provider', async (request, reply) => {
      const provider = providers.get((request.params as { provider?: string }).provider ?? '');
      if (!provider) return reply.code(404).send({ error: 'unknown_provider' });
      const event = provider.verifyWebhook(String(request.body ?? ''), request.headers);
      if (!event) return reply.code(401).send({ error: 'invalid_signature' });
      return { result: await applyEvent(db, provider.name, event) };
    });
  });

  if (!sandbox) return;

  // --- Prestataire sandbox (jamais en production) : la page de paiement factice du site l'appelle. ---
  const sessionOf = async (userId: string, sessionId: string) =>
    (
      await db.query<{ id: string; amount: number; currency: string; status: string; product_id: string; name: Record<string, string>; contents: { gems?: number } }>(
        `SELECT t.id, t.amount, t.currency, t.status, t.product_id, p.name, t.contents FROM transactions t JOIN products p ON p.id = t.product_id
         WHERE t.user_id = $1 AND t.provider = 'sandbox' AND t.provider_session_id = $2`,
        [userId, sessionId],
      )
    )[0];

  app.get('/api/payments/sandbox/:session', { preHandler: requireUser }, async (request, reply) => {
    const s = await sessionOf(request.user!.id, (request.params as { session: string }).session);
    if (!s) return reply.code(404).send({ error: 'unknown_session' });
    return { session: { amount: s.amount, currency: s.currency, status: s.status, name: s.name, gems: s.contents.gems ?? 0 } };
  });

  app.post('/api/payments/sandbox/:session/:action', { preHandler: requireUser }, async (request, reply) => {
    const { session, action } = request.params as { session: string; action: string };
    const s = await sessionOf(request.user!.id, session);
    if (!s) return reply.code(404).send({ error: 'unknown_session' });
    if (s.status !== 'pending') return reply.code(409).send({ error: 'session_closed' });
    if (action === 'pay') await sandbox.pay(session, s.amount, s.currency);
    else if (action === 'cancel') await cancelPending(db, request.user!.id, 'sandbox', session);
    else return reply.code(400).send({ error: 'invalid_input' });
    return { ok: true };
  });
}
