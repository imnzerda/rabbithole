import type { FastifyInstance } from 'fastify';
import { validateDeck, type MatchContext } from '@rabbithole/engine';
import { z } from 'zod';
import { requireUser } from '../auth/routes.js';
import type { Db } from '../db/db.js';
import type { AppDeps } from '../deps.js';
import type { CatalogDto } from '@rabbithole/shared';

export interface Deck {
  id: string;
  name: string;
  leaderId: string;
  cardIds: string[];
  updatedAt: string;
}

interface DeckRow {
  id: string;
  name: string;
  leader_id: string;
  card_ids: string[];
  updated_at: string | Date;
}

const toDeck = (r: DeckRow): Deck => ({
  id: r.id,
  name: r.name,
  leaderId: r.leader_id,
  cardIds: r.card_ids,
  updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
});

export async function getCollection(db: Db, userId: string): Promise<Map<string, number>> {
  const rows = await db.query<{ card_id: string; quantity: number }>('SELECT card_id, quantity FROM collections WHERE user_id = $1', [userId]);
  return new Map(rows.map((r) => [r.card_id, r.quantity]));
}

export async function listDecks(db: Db, userId: string): Promise<Deck[]> {
  return (await db.query<DeckRow>('SELECT * FROM decks WHERE user_id = $1 ORDER BY updated_at DESC', [userId])).map(toDeck);
}

export async function getDeck(db: Db, userId: string, id: string): Promise<Deck | null> {
  const [row] = await db.query<DeckRow>('SELECT * FROM decks WHERE id = $1 AND user_id = $2', [id, userId]);
  return row ? toDeck(row) : null;
}

/** Règles du jeu (moteur) + possession : on ne joue que ce qu'on a dans sa collection. */
export async function checkDeck(db: Db, ctx: MatchContext, userId: string, leaderId: string, cardIds: string[]): Promise<string[]> {
  const errors = validateDeck(ctx, leaderId, cardIds);
  const owned = await getCollection(db, userId);
  if (!owned.get(leaderId)) errors.push(`Leader non possédé : ${leaderId}`);
  const counts = new Map<string, number>();
  for (const id of cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    if (n > (owned.get(id) ?? 0)) errors.push(`Pas assez d'exemplaires de ${id} (${owned.get(id) ?? 0} possédé(s), ${n} demandé(s)).`);
  }
  return errors;
}

const uuid = z.string().uuid();
const deckSchema = z.object({
  name: z.string().trim().min(1).max(40),
  leaderId: z.string().min(1).max(80),
  cardIds: z.array(z.string().min(1).max(80)).max(60),
});

export function registerDecks(app: FastifyInstance, { db, catalog }: AppDeps): void {
  // Catalogue publié (version courante), et cartes d'une version passée (replays).
  app.get('/api/catalog', async (): Promise<CatalogDto> => {
    const { version, ctx, leaders, collectibles } = catalog.current;
    return { version, rules: ctx.rules, cards: Object.values(ctx.cards), collectible: [...leaders, ...collectibles].map((c) => c.id) };
  });
  app.get('/api/catalog/:version', async (request, reply) => {
    const version = (request.params as { version: string }).version.slice(0, 80);
    const cards = await catalog.cardsOf(version);
    if (!cards) return reply.code(404).send({ error: 'not_found' });
    return { version, rules: catalog.current.ctx.rules, cards, collectible: [] } satisfies CatalogDto;
  });

  app.get('/api/collection', { preHandler: requireUser }, async (request) => {
    const owned = await getCollection(db, request.user!.id);
    return { cards: [...owned].map(([cardId, quantity]) => ({ cardId, quantity })) };
  });

  app.get('/api/decks', { preHandler: requireUser }, async (request) => ({ decks: await listDecks(db, request.user!.id) }));

  app.post('/api/decks', { preHandler: requireUser }, async (request, reply) => {
    const parsed = deckSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const { name, leaderId, cardIds } = parsed.data;
    const errors = await checkDeck(db, catalog.current.ctx, request.user!.id, leaderId, cardIds);
    if (errors.length) return reply.code(400).send({ error: 'invalid_deck', errors });
    const [row] = await db.query<DeckRow>('INSERT INTO decks (user_id, name, leader_id, card_ids) VALUES ($1, $2, $3, $4) RETURNING *', [
      request.user!.id,
      name,
      leaderId,
      cardIds,
    ]);
    return reply.code(201).send({ deck: toDeck(row!) });
  });

  app.put('/api/decks/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = uuid.safeParse((request.params as { id: string }).id);
    const parsed = deckSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await getDeck(db, request.user!.id, id.data))) return reply.code(404).send({ error: 'not_found' });
    const { name, leaderId, cardIds } = parsed.data;
    const errors = await checkDeck(db, catalog.current.ctx, request.user!.id, leaderId, cardIds);
    if (errors.length) return reply.code(400).send({ error: 'invalid_deck', errors });
    const [row] = await db.query<DeckRow>(
      'UPDATE decks SET name = $1, leader_id = $2, card_ids = $3, updated_at = now() WHERE id = $4 AND user_id = $5 RETURNING *',
      [name, leaderId, cardIds, id.data, request.user!.id],
    );
    return { deck: toDeck(row!) };
  });

  app.delete('/api/decks/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = uuid.safeParse((request.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'invalid_input' });
    const rows = await db.query('DELETE FROM decks WHERE id = $1 AND user_id = $2 RETURNING id', [id.data, request.user!.id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
