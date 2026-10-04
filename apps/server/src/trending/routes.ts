import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../admin/routes.js';
import { requireUser } from '../auth/routes.js';
import type { AppDeps } from '../deps.js';
import { dateKey, publicTrending, setExcluded, trendingOf } from './trending.js';

/** Tendance du jour : liste publiée (joueurs), vérification et liste de surveillance (admin). */
export function registerTrending(app: FastifyInstance, { db, config }: AppDeps): void {
  app.get('/api/trending', { preHandler: requireUser }, async () => publicTrending(db));

  // Données de test (tests automatisés uniquement, interdit en production par la config) : liste publiée.
  if (config.testFixtures) {
    app.post('/api/test/trending', { preHandler: requireUser }, async (request, reply) => {
      const body = z.object({ cardIds: z.array(z.string().min(1).max(80)).max(20) }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
      const day = dateKey(new Date());
      await db.query('DELETE FROM trending WHERE date = $1', [day]);
      for (const [i, cardId] of body.data.cardIds.entries()) {
        await db.query('INSERT INTO trending (date, card_id, score, views, average) VALUES ($1, $2, $3, $4, $5)', [day, cardId, 10 - i, 5000, 500]);
      }
      await db.query('INSERT INTO trending_runs (date, published_at) VALUES ($1, now()) ON CONFLICT (date) DO UPDATE SET published_at = now()', [day]);
      return { ok: true };
    });
  }

  const admin = { preHandler: requireAdmin };
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

  app.get('/api/admin/trending', admin, async (request, reply) => {
    const query = z.object({ date: date.optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_input' });
    const day = query.data.date ?? dateKey(new Date());
    const [run] = await db.query<{ computed_at: string; published_at: string | null }>('SELECT computed_at, published_at FROM trending_runs WHERE date = $1', [day]);
    const watchlist = await db.query<{ card_id: string; reason: string }>('SELECT card_id, reason FROM trending_watchlist ORDER BY created_at DESC');
    return { date: day, run: run ?? null, cards: await trendingOf(db, day, true), watchlist: watchlist.map((w) => ({ cardId: w.card_id, reason: w.reason })) };
  });

  /** Écarter (ou rétablir) une carte du jour, avant ou après publication. */
  app.post('/api/admin/trending/exclude', admin, async (request, reply) => {
    const body = z.object({ date, cardId: z.string().min(1).max(80), excluded: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await setExcluded(db, body.data.date, body.data.cardId, body.data.excluded))) return reply.code(404).send({ error: 'not_found' });
    await db.query("INSERT INTO admin_audit (admin_id, action, target, payload) VALUES ($1, 'trending.exclude', $2, $3)", [request.user!.id, body.data.cardId, JSON.stringify(body.data)]);
    return { ok: true };
  });

  app.post('/api/admin/trending/watchlist', admin, async (request, reply) => {
    const body = z.object({ cardId: z.string().min(1).max(80), reason: z.string().trim().max(500).default('') }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    await db.query('INSERT INTO trending_watchlist (card_id, reason) VALUES ($1, $2) ON CONFLICT (card_id) DO UPDATE SET reason = EXCLUDED.reason', [body.data.cardId, body.data.reason]);
    await db.query("INSERT INTO admin_audit (admin_id, action, target, payload) VALUES ($1, 'trending.watchlist.add', $2, $3)", [request.user!.id, body.data.cardId, JSON.stringify(body.data)]);
    return { ok: true };
  });

  app.delete('/api/admin/trending/watchlist/:cardId', admin, async (request) => {
    const cardId = (request.params as { cardId: string }).cardId;
    await db.query('DELETE FROM trending_watchlist WHERE card_id = $1', [cardId]);
    await db.query("INSERT INTO admin_audit (admin_id, action, target, payload) VALUES ($1, 'trending.watchlist.remove', $2, '{}')", [request.user!.id, cardId]);
    return { ok: true };
  });
}
