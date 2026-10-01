import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../admin/routes.js';
import { audit } from '../admin/admin.js';
import { requireUser } from '../auth/routes.js';
import type { AppDeps } from '../deps.js';
import { contentFilterFor } from './filter.js';

const REPORT_REASONS = ['offensive', 'inaccurate', 'minor', 'victim', 'copyright', 'privacy', 'harassment', 'cheating', 'name', 'other'] as const;

/**
 * Côté joueur : réglage « contenu sensible », filtre d'affichage, signalements, demandes de retrait, crédits.
 * Côté admin : files des signalements et des demandes de retrait, règles par pays.
 */
export function registerModeration(app: FastifyInstance, { db, config, catalog }: AppDeps): void {
  const limited = { config: { rateLimit: { max: config.authRateLimit, timeWindow: '1 minute' } } };
  const admin = { preHandler: requireAdmin };

  // --- Joueurs ---------------------------------------------------------------------------

  app.post('/api/me/settings', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ showSensitive: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    await db.query('UPDATE users SET show_sensitive = $2 WHERE id = $1', [request.user!.id, body.data.showSensitive]);
    return { showSensitive: body.data.showSensitive };
  });

  /** Cartes bloquées (pays) et masquées (bloquées + sensibles si l'interrupteur est coupé) pour ce joueur. */
  app.get('/api/content-filter', async (request) => {
    const f = await contentFilterFor(db, request.user, catalog.current);
    return { blocked: [...f.blocked], masked: [...f.masked], showSensitive: request.user?.showSensitive ?? false };
  });

  /** Crédits de toutes les images des cartes jouables (section 10.2). */
  app.get('/api/credits', async () => {
    const ids = Object.keys(catalog.current.ctx.cards);
    const rows = await db.query<{ card_id: string; source_url: string; file_page: string; author: string; license: string; license_url: string | null; modified: boolean }>(
      'SELECT card_id, source_url, file_page, author, license, license_url, modified FROM card_images WHERE active AND card_id = ANY($1::text[]) ORDER BY card_id',
      [ids],
    );
    return {
      credits: rows.map((r) => ({
        cardId: r.card_id,
        imageUrl: r.source_url,
        filePage: r.file_page,
        author: r.author,
        license: r.license,
        licenseUrl: r.license_url,
        modified: r.modified,
      })),
    };
  });

  app.post('/api/reports', { ...limited, preHandler: requireUser }, async (request, reply) => {
    const body = z
      .object({
        target: z.discriminatedUnion('type', [
          z.object({ type: z.literal('card'), cardId: z.string().min(1).max(80) }),
          z.object({ type: z.literal('player'), matchId: z.string().uuid() }),
        ]),
        reason: z.enum(REPORT_REASONS),
        details: z.string().trim().max(1000).optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const me = request.user!.id;
    const [today] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM reports WHERE reporter_id = $1 AND created_at > now() - interval '1 day'", [me]);
    if ((today?.n ?? 0) >= 20) return reply.code(429).send({ error: 'too_many_reports' });

    const { target, reason, details } = body.data;
    if (target.type === 'card') {
      if (!catalog.current.ctx.cards[target.cardId]) return reply.code(404).send({ error: 'not_found' });
      await db.query("INSERT INTO reports (reporter_id, target_type, card_id, reason, details) VALUES ($1, 'card', $2, $3, $4)", [me, target.cardId, reason, details ?? null]);
    } else {
      // On ne signale que l'adversaire d'une partie à laquelle on a participé.
      const [m] = await db.query<{ player_a: string | null; player_b: string | null }>('SELECT player_a, player_b FROM matches WHERE id = $1', [target.matchId]);
      if (!m || (m.player_a !== me && m.player_b !== me)) return reply.code(404).send({ error: 'not_found' });
      const opponent = m.player_a === me ? m.player_b : m.player_a;
      if (!opponent) return reply.code(400).send({ error: 'ghost_opponent' });
      await db.query("INSERT INTO reports (reporter_id, target_type, target_user_id, match_id, reason, details) VALUES ($1, 'player', $2, $3, $4, $5)", [
        me,
        opponent,
        target.matchId,
        reason,
        details ?? null,
      ]);
    }
    return reply.code(201).send({ ok: true });
  });

  /** Demande de retrait (section 5) : formulaire public, sans compte, traitement sous 72 h. */
  app.post('/api/takedown', limited, async (request, reply) => {
    const body = z
      .object({
        cardId: z.string().min(1).max(80),
        name: z.string().trim().min(2).max(120),
        contact: z.string().trim().email().max(200),
        relation: z.enum(['self', 'representative', 'rights_holder', 'other']),
        reason: z.string().trim().min(10).max(4000),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const [card] = await db.query('SELECT 1 FROM cards WHERE id = $1', [body.data.cardId]);
    if (!card) return reply.code(404).send({ error: 'not_found' });
    const [row] = await db.query<{ id: string; due_at: string | Date }>(
      'INSERT INTO takedown_requests (card_id, requester_name, requester_contact, relation, reason) VALUES ($1, $2, $3, $4, $5) RETURNING id, due_at',
      [body.data.cardId, body.data.name, body.data.contact, body.data.relation, body.data.reason],
    );
    return reply.code(201).send({ id: row!.id, dueAt: new Date(row!.due_at).toISOString() });
  });

  // --- Administration ----------------------------------------------------------------------

  app.get('/api/admin/reports', admin, async (request) => {
    const { status } = z.object({ status: z.enum(['open', 'resolved', 'dismissed']).default('open') }).parse(request.query);
    const rows = await db.query(
      `SELECT r.id, r.target_type, r.card_id, r.match_id, r.reason, r.details, r.status, r.resolution, r.created_at,
              rep.display_name AS reporter, tu.display_name AS target_user, r.target_user_id,
              c.def->'name'->>'fr' AS card_name,
              (SELECT count(*)::int FROM reports o WHERE o.status = 'open' AND ((r.card_id IS NOT NULL AND o.card_id = r.card_id) OR (r.target_user_id IS NOT NULL AND o.target_user_id = r.target_user_id))) AS open_on_target
       FROM reports r
       LEFT JOIN users rep ON rep.id = r.reporter_id
       LEFT JOIN users tu ON tu.id = r.target_user_id
       LEFT JOIN cards c ON c.id = r.card_id
       WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 300`,
      [status],
    );
    return { reports: rows };
  });

  app.post('/api/admin/reports/:id', admin, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ status: z.enum(['resolved', 'dismissed']), resolution: z.string().trim().min(3).max(1000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'resolution_required' });
    const done = await db.query('UPDATE reports SET status = $2, resolution = $3, resolved_by = $4, resolved_at = now() WHERE id = $1 RETURNING id', [
      id,
      body.data.status,
      body.data.resolution,
      request.user!.id,
    ]);
    if (!done.length) return reply.code(404).send({ error: 'not_found' });
    await audit(db, request.user!.id, `report.${body.data.status}`, id, { resolution: body.data.resolution });
    return { ok: true };
  });

  app.get('/api/admin/takedowns', admin, async () => {
    const rows = await db.query(
      `SELECT t.*, c.def->'name'->>'fr' AS card_name, c.status AS card_status, t.due_at < now() AS overdue
       FROM takedown_requests t LEFT JOIN cards c ON c.id = t.card_id
       ORDER BY (t.status IN ('open', 'in_progress')) DESC, t.due_at LIMIT 300`,
    );
    return { takedowns: rows };
  });

  /** Traitement d'une demande de retrait ; « retirer la carte » la sort du jeu immédiatement. */
  app.post('/api/admin/takedowns/:id', admin, async (request, reply: FastifyReply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ status: z.enum(['in_progress', 'done', 'rejected']), resolution: z.string().trim().max(2000).default(''), retireCard: z.boolean().default(false) })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const [t] = await db.query<{ card_id: string }>('SELECT card_id FROM takedown_requests WHERE id = $1', [id]);
    if (!t) return reply.code(404).send({ error: 'not_found' });
    const final = body.data.status !== 'in_progress';
    await db.query(`UPDATE takedown_requests SET status = $2, resolution = $3, resolved_at = ${final ? 'now()' : 'NULL'} WHERE id = $1`, [id, body.data.status, body.data.resolution]);
    if (body.data.retireCard) {
      await db.query("UPDATE cards SET status = 'retired', updated_at = now() WHERE id = $1", [t.card_id]);
      await audit(db, request.user!.id, 'card.retired', t.card_id, { takedown: id });
      await catalog.reload();
    }
    await audit(db, request.user!.id, `takedown.${body.data.status}`, id, { cardId: t.card_id, retired: body.data.retireCard });
    return { ok: true };
  });

  app.get('/api/admin/country-rules', admin, async () => ({
    rules: await db.query('SELECT country, allow_adult, allow_political, blocked_card_ids, updated_at FROM country_rules ORDER BY country'),
  }));

  app.put('/api/admin/country-rules/:country', admin, async (request, reply) => {
    const { country } = z.object({ country: z.string().regex(/^[A-Z]{2}$/) }).parse(request.params);
    const body = z
      .object({ allowAdult: z.boolean(), allowPolitical: z.boolean(), blockedCardIds: z.array(z.string().min(1).max(80)).max(1000) })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    await db.query(
      `INSERT INTO country_rules (country, allow_adult, allow_political, blocked_card_ids) VALUES ($1, $2, $3, $4)
       ON CONFLICT (country) DO UPDATE SET allow_adult = $2, allow_political = $3, blocked_card_ids = $4, updated_at = now()`,
      [country, body.data.allowAdult, body.data.allowPolitical, body.data.blockedCardIds],
    );
    await audit(db, request.user!.id, 'country_rules.set', country, body.data);
    return { ok: true };
  });
}
