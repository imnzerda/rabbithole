import { PROTOTYPE_DECKS } from '@rabbithole/content';
import { catalogBudget, simulateMatchup, validateDeck, type CardDef } from '@rabbithole/engine';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import type { AppDeps } from '../deps.js';
import {
  AdminError,
  audit,
  cardFromCandidate,
  clearPolicy,
  createBlankCard,
  createSeries,
  getCard,
  importCandidates,
  listCandidates,
  listCards,
  listSeries,
  preview,
  saveCard,
  setCandidateStatus,
  setCardStatus,
  setImageActive,
  setSeriesStatus,
  workingContext,
  type PipelineRun,
} from './admin.js';

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireUser(request, reply);
  if (reply.sent) return;
  if (request.user!.role !== 'admin') await reply.code(403).send({ error: 'forbidden' });
}

const cardType = z.enum(['leader', 'character', 'event']);
const id = z.string().min(1).max(80);

/** API de l'outil d'administration (`apps/admin`) : réservée au rôle `admin`, chaque modification est journalisée. */
export function registerAdmin(app: FastifyInstance, { db, catalog }: AppDeps): void {
  const admin = { preHandler: requireAdmin };
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof AdminError) return reply.code(err.status).send({ error: err.code, details: err.details });
    throw err;
  };
  const me = (request: FastifyRequest) => request.user!.id;
  /** Une publication (carte ou série) change le catalogue joué : on le relit. */
  const republish = () => catalog.reload();

  app.get('/api/admin/overview', admin, async () => {
    const [counts] = await db.query<Record<string, number>>(
      `SELECT
         (SELECT count(*)::int FROM candidates) AS candidates,
         (SELECT count(*)::int FROM candidates WHERE status = 'shortlisted') AS shortlisted,
         (SELECT count(*)::int FROM candidates WHERE policy_status = 'needs_review' AND status <> 'rejected') AS candidates_to_review,
         (SELECT count(*)::int FROM cards WHERE status = 'draft') AS drafts,
         (SELECT count(*)::int FROM cards WHERE status = 'review') AS in_review,
         (SELECT count(*)::int FROM cards WHERE status = 'published') AS published,
         (SELECT count(*)::int FROM cards WHERE policy_status = 'needs_review' AND policy_cleared_by IS NULL AND status <> 'retired') AS policy_pending,
         (SELECT count(*)::int FROM reports WHERE status = 'open') AS reports_open,
         (SELECT count(*)::int FROM takedown_requests WHERE status IN ('open', 'in_progress')) AS takedowns_open,
         (SELECT count(*)::int FROM takedown_requests WHERE status IN ('open', 'in_progress') AND due_at < now()) AS takedowns_overdue`,
    );
    return { counts, catalogVersion: catalog.current.version };
  });

  // --- Candidats -------------------------------------------------------------------------
  app.post('/api/admin/candidates/import', { ...admin, bodyLimit: 30 * 1024 * 1024 }, async (request, reply) => {
    const run = request.body as PipelineRun;
    if (!run || typeof run.series !== 'string' || !Array.isArray(run.candidates)) return reply.code(400).send({ error: 'invalid_run' });
    try {
      const result = await importCandidates(db, run);
      await audit(db, me(request), 'candidates.import', run.series, result);
      return result;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/admin/candidates', admin, async (request) => {
    const q = z
      .object({
        category: z.string().max(40).optional(),
        status: z.enum(['new', 'shortlisted', 'rejected', 'carded']).optional(),
        policy: z.enum(['ok', 'needs_review', 'excluded']).optional(),
        q: z.string().max(80).optional(),
        minScore: z.coerce.number().min(0).max(100).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query);
    return listCandidates(db, q);
  });

  app.post('/api/admin/candidates/:qid/status', admin, async (request, reply) => {
    const { qid } = z.object({ qid: z.string().regex(/^Q\d+$/) }).parse(request.params);
    const body = z.object({ status: z.enum(['new', 'shortlisted', 'rejected']) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await setCandidateStatus(db, qid, body.data.status);
      await audit(db, me(request), `candidate.${body.data.status}`, qid);
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/admin/candidates/:qid/card', admin, async (request, reply) => {
    const { qid } = z.object({ qid: z.string().regex(/^Q\d+$/) }).parse(request.params);
    const body = z.object({ series: id, type: cardType.default('character') }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const def = await cardFromCandidate(db, qid, body.data.series, body.data.type);
      await audit(db, me(request), 'card.create_from_candidate', def.id, { qid });
      return reply.code(201).send({ card: def });
    } catch (err) {
      return fail(reply, err);
    }
  });

  // --- Cartes ----------------------------------------------------------------------------
  app.get('/api/admin/cards', admin, async (request) => {
    const q = z.object({ series: z.string().max(80).optional(), status: z.string().max(20).optional(), q: z.string().max(80).optional() }).parse(request.query);
    return { cards: await listCards(db, q) };
  });

  app.post('/api/admin/cards', admin, async (request, reply) => {
    const body = z.object({ series: id, type: cardType, name: z.string().trim().min(1).max(80) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const def = await createBlankCard(db, body.data.series, body.data.type, body.data.name);
      await audit(db, me(request), 'card.create', def.id);
      return reply.code(201).send({ card: def });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/admin/cards/:id', admin, async (request, reply) => {
    try {
      return await getCard(db, z.object({ id }).parse(request.params).id, await workingContext(db));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Aperçu en direct dans l'éditeur : erreurs, budget, texte, sans enregistrer. */
  app.post('/api/admin/cards/preview', admin, async (request) => preview((request.body as { def: CardDef }).def, await workingContext(db)));

  app.put('/api/admin/cards/:id', admin, async (request, reply) => {
    const cardId = z.object({ id }).parse(request.params).id;
    const def = (request.body as { def?: CardDef })?.def;
    if (!def || typeof def !== 'object') return reply.code(400).send({ error: 'invalid_input' });
    try {
      const saved = await saveCard(db, cardId, def, await workingContext(db));
      await audit(db, me(request), 'card.save', cardId, { version: saved.version });
      if (saved.status === 'published') await republish();
      return saved;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/admin/cards/:id/status', admin, async (request, reply) => {
    const cardId = z.object({ id }).parse(request.params).id;
    const body = z.object({ status: z.enum(['draft', 'review', 'published', 'retired']) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await setCardStatus(db, cardId, body.data.status, await workingContext(db));
      await audit(db, me(request), `card.${body.data.status}`, cardId);
      await republish();
      return { ok: true, catalogVersion: catalog.current.version };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/admin/cards/:id/clear-policy', admin, async (request, reply) => {
    const cardId = z.object({ id }).parse(request.params).id;
    const body = z.object({ note: z.string().trim().min(5).max(1000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'note_required' });
    try {
      await clearPolicy(db, cardId, me(request), body.data.note);
      await audit(db, me(request), 'card.clear_policy', cardId, { note: body.data.note });
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/admin/cards/:id/images/:imageId', admin, async (request, reply) => {
    const p = z.object({ id, imageId: z.string().uuid() }).parse(request.params);
    const body = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await setImageActive(db, p.id, p.imageId, body.data.active);
      await audit(db, me(request), body.data.active ? 'image.restore' : 'image.remove', p.id, { imageId: p.imageId });
      await republish();
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // --- Séries ----------------------------------------------------------------------------
  app.get('/api/admin/series', admin, async () => ({ series: await listSeries(db) }));

  app.post('/api/admin/series', admin, async (request, reply) => {
    const body = z
      .object({
        id: z.string().regex(/^[a-z0-9_]{2,40}$/),
        type: z.enum(['base', 'world', 'country']),
        country: z.string().regex(/^[A-Z]{2}$/).nullable().default(null),
        name: z.object({ fr: z.string().min(1).max(80), en: z.string().min(1).max(80) }),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await createSeries(db, body.data);
      await audit(db, me(request), 'series.create', body.data.id);
      return reply.code(201).send({ ok: true });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/admin/series/:id/status', admin, async (request, reply) => {
    const seriesId = z.object({ id }).parse(request.params).id;
    const body = z.object({ status: z.enum(['draft', 'review', 'published']) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      await setSeriesStatus(db, seriesId, body.data.status);
      await audit(db, me(request), `series.${body.data.status}`, seriesId);
      await republish();
      return { ok: true, catalogVersion: catalog.current.version };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // --- Équilibrage -----------------------------------------------------------------------
  app.get('/api/admin/budget', admin, async () => {
    const rows = await db.query<{ def: CardDef; status: string }>("SELECT def, status FROM cards WHERE status <> 'retired'");
    const status = new Map(rows.map((r) => [r.def.id, r.status]));
    return { cards: catalogBudget(rows.map((r) => r.def)).map((r) => ({ ...r, status: status.get(r.id) })) };
  });

  /** Simulations IA contre IA : decks préconstruits ou listes de cartes ; brouillons compris si demandé. */
  app.post('/api/admin/simulate', admin, async (request, reply) => {
    const deck = z.union([z.object({ prebuilt: z.string() }), z.object({ leader: id, deck: z.array(id).max(60) })]);
    const body = z.object({ a: deck, b: deck, games: z.number().int().min(2).max(200).default(50), includeDrafts: z.boolean().default(false) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const ctx = body.data.includeDrafts ? await workingContext(db) : catalog.current.ctx;
    const resolve = (d: z.infer<typeof deck>) => {
      if ('prebuilt' in d) {
        const p = PROTOTYPE_DECKS.find((x) => x.id === d.prebuilt);
        return p ? { leader: p.leader, deck: p.cards } : null;
      }
      return d;
    };
    const a = resolve(body.data.a);
    const b = resolve(body.data.b);
    if (!a || !b) return reply.code(404).send({ error: 'unknown_deck' });
    const errors = [...validateDeck(ctx, a.leader, a.deck), ...validateDeck(ctx, b.leader, b.deck)];
    if (errors.length) return reply.code(400).send({ error: 'invalid_deck', details: errors });
    const result = simulateMatchup(ctx, a, b, body.data.games, `admin:${Date.now()}`);
    await audit(db, me(request), 'simulate', null, { games: body.data.games, winsA: result.winsA, winsB: result.winsB });
    return result;
  });

  app.get('/api/admin/decks', admin, async () => ({ decks: PROTOTYPE_DECKS.map((d) => ({ id: d.id, name: d.name, leader: d.leader })) }));

  // --- Journal -----------------------------------------------------------------------------
  app.get('/api/admin/audit', admin, async (request) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query);
    const rows = await db.query(
      `SELECT a.id, a.action, a.target, a.payload, a.created_at, u.display_name AS admin
       FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.created_at DESC LIMIT $1`,
      [limit],
    );
    return { entries: rows };
  });
}
