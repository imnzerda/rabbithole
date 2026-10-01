import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { grantStarterKit } from '../content.js';
import type { AppDeps } from '../deps.js';
import {
  ageOn,
  checkCredentials,
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
  hashPassword,
  publicUser,
  userForToken,
  type User,
} from './accounts.js';

export const SESSION_COOKIE = 'rh_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionToken: string | null;
  }
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'date invalide');

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(2).max(24),
  birthDate: isoDate,
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  locale: z.enum(['fr', 'en', 'es', 'pt-BR', 'de']),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

/** Jeton de session : cookie httpOnly (navigateur) ou en-tête Authorization (outils, tests). */
export function readToken(request: FastifyRequest): string | null {
  const cookie = request.cookies[SESSION_COOKIE];
  if (cookie) return cookie;
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) await reply.code(401).send({ error: 'unauthorized' });
}

export function registerAuth(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;

  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);
  app.addHook('onRequest', async (request) => {
    const token = readToken(request);
    if (!token) return;
    request.user = await userForToken(db, token);
    request.sessionToken = request.user ? token : null;
  });

  const setSession = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: config.sessionDays * 24 * 3600,
    });

  const limited = { config: { rateLimit: { max: config.authRateLimit, timeWindow: '1 minute' } } };

  app.post('/api/auth/signup', limited, async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues.map((i) => i.path.join('.')) });
    const input = parsed.data;
    // Accès refusé avant l'âge minimum (CGU 21+).
    if (ageOn(input.birthDate, new Date()) < config.minAge) {
      return reply.code(403).send({ error: 'too_young', minAge: config.minAge });
    }
    if (await findUserByEmail(db, input.email)) return reply.code(409).send({ error: 'email_taken' });

    const passwordHash = await hashPassword(input.password);
    const user = await db.transaction(async (tx) => {
      const created = await createUser(tx, { ...input, passwordHash });
      await grantStarterKit(tx, created.id);
      return created;
    });
    setSession(reply, await createSession(db, user.id, config.sessionDays));
    return reply.code(201).send({ user: publicUser(user) });
  });

  app.post('/api/auth/login', limited, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const user = await checkCredentials(db, parsed.data.email, parsed.data.password);
    if (!user) return reply.code(401).send({ error: 'invalid_credentials' });
    setSession(reply, await createSession(db, user.id, config.sessionDays));
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.sessionToken) await deleteSession(db, request.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requireUser }, async (request) => ({ user: publicUser(request.user!) }));

  // Vérifier la session n'est pas une erreur : toujours 200, `user` vaut null si personne n'est connecté.
  app.get('/api/session', async (request) => ({ user: request.user ? publicUser(request.user) : null }));
}
