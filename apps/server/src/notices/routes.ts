import type { NoticeDto } from '@rabbithole/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import type { AppDeps } from '../deps.js';

/** Notifications du joueur (ex. carte retirée du jeu et compensée en pièces). */
export function registerNotices(app: FastifyInstance, { db }: AppDeps): void {
  app.get('/api/notices', { preHandler: requireUser }, async (request) => {
    const rows = await db.query<{ id: string; kind: string; payload: Record<string, unknown>; created_at: string | Date; read_at: string | Date | null }>(
      'SELECT id, kind, payload, created_at, read_at FROM notices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30',
      [request.user!.id],
    );
    const notices: NoticeDto[] = rows.map((r) => ({ id: r.id, kind: r.kind, payload: r.payload, createdAt: new Date(r.created_at).toISOString(), read: r.read_at !== null }));
    return { notices };
  });

  /** Marque comme lues une notification, ou toutes (sans identifiant). */
  app.post('/api/notices/read', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ id: z.string().uuid().optional() }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    await db.query(`UPDATE notices SET read_at = now() WHERE user_id = $1 AND read_at IS NULL ${body.data.id ? 'AND id = $2' : ''}`, [
      request.user!.id,
      ...(body.data.id ? [body.data.id] : []),
    ]);
    return { ok: true };
  });
}
