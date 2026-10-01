import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { canonicalEmailTaken, checkCredentials, createSession, deleteSession, hashPassword, publicUser, userForToken, type User } from './accounts.js';
import { checkDevices, ensureDevice, recordSignals, requestSignals, signalHash } from './antiabuse.js';
import { canonicalEmail, ConsoleSms, subnetOf } from './guard.js';
import { createPending, finishSignup, sendPhoneCode, SignupError, verifyPhoneCode, type RiskReason } from './signup.js';

export const SESSION_COOKIE = 'rh_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionToken: string | null;
  }
}

/** Empreintes calculées par le navigateur (`apps/web/src/lib/hwid.ts`), hachées dès réception. */
const clientSignal = z.string().min(8).max(2000).optional();

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(2).max(24),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  locale: z.enum(['fr', 'en', 'es', 'pt-BR', 'de']),
  hwid: clientSignal,
  fp: clientSignal,
  /** Jeton Cloudflare Turnstile (captcha invisible). */
  captchaToken: z.string().max(4096).optional(),
  /** Pot de miel : champ invisible pour les humains, rempli par les robots. */
  website: z.string().max(500).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  hwid: clientSignal,
  fp: clientSignal,
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
  const { db, config, guard } = deps;
  const g = config.guard;

  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);
  app.decorateRequest('deviceId', null);
  app.addHook('onRequest', async (request, reply) => {
    ensureDevice(request, reply, config);
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
  const ipHash = (request: FastifyRequest) => signalHash(`ip:${request.ip}`, config);
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof SignupError) return reply.code(err.status).send({ error: err.code, ...err.extra });
    throw err;
  };

  /** Ce dont le formulaire d'inscription a besoin (la clé de site Turnstile est publique). */
  app.get('/api/auth/config', async () => ({ turnstileSiteKey: g.turnstile?.siteKey ?? null, smsMode: g.smsMode }));

  app.post('/api/auth/signup', limited, async (request, reply) => {
    // 1. Débit : quelques tentatives par minute et par IP / sous-réseau, puis blocage temporaire.
    const blockMs = g.signupBlockMinutes * 60_000;
    const wait = Math.max(
      guard.limiter.hit(`signup:ip:${request.ip}`, g.signupPerIpPerMinute, 60_000, blockMs),
      guard.limiter.hit(`signup:net:${subnetOf(request.ip)}`, g.signupPerSubnetPerMinute, 60_000, blockMs),
    );
    if (wait > 0) return reply.code(429).header('retry-after', wait).send({ error: 'too_many_attempts', retryAfter: wait });

    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues.map((i) => i.path.join('.')) });
    const input = parsed.data;

    // 2. Robots : pot de miel, puis captcha invisible.
    if (input.website) {
      request.log.warn('inscription refusée : pot de miel rempli');
      return reply.code(400).send({ error: 'invalid_input' });
    }
    if (!(await guard.captcha.verify(input.captchaToken, request.ip))) return reply.code(400).send({ error: 'captcha_failed' });

    // 3. E-mail : jetable refusé ; alias (« +… », points Gmail) ramenés à l'adresse de base.
    if (guard.disposable.isDisposableEmail(input.email)) return reply.code(400).send({ error: 'disposable_email' });
    const canonical = canonicalEmail(input.email);
    if (await canonicalEmailTaken(db, canonical)) return reply.code(409).send({ error: 'email_taken' });

    // 4. Appareil : un appareil = un compte.
    const signals = requestSignals(request, config, input);
    const device = await checkDevices(db, config, signals);
    if (device.blocked) return reply.code(409).send({ error: 'device_has_account' });

    // 5. Risque : VPN / proxy, ou appareil déjà vu sur un autre compte → vérification par SMS.
    const forcedVpn = config.testFixtures && request.headers['x-test-risk'] === 'vpn';
    const vpn = forcedVpn || (await guard.ipReputation.check(request.ip)).risky;
    const reasons: RiskReason[] = [];
    if (g.smsMode === 'always') reasons.push('always');
    else if (g.smsMode === 'risky') {
      if (vpn) reasons.push('vpn');
      if (device.seenElsewhere) reasons.push('device_elsewhere');
    } else if (vpn) return reply.code(403).send({ error: 'vpn_blocked' });

    const payload = {
      email: input.email,
      canonicalEmail: canonical,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName,
      country: input.country,
      locale: input.locale,
    };
    if (reasons.length > 0) {
      const pendingId = await createPending(db, payload, signals, reasons);
      return reply.code(202).send({ pendingId, verify: 'phone' });
    }
    try {
      const user = await finishSignup(db, config, payload, signals, null);
      setSession(reply, await createSession(db, user.id, config.sessionDays));
      return reply.code(201).send({ user: publicUser(user) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  const idParams = z.object({ id: z.string().max(64) });

  app.post('/api/auth/signup/:id/phone', limited, async (request, reply) => {
    const body = z.object({ phone: z.string().min(4).max(32) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_phone' });
    try {
      return await sendPhoneCode(db, config, guard, idParams.parse(request.params).id, body.data.phone, ipHash(request));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/auth/signup/:id/verify', limited, async (request, reply) => {
    const body = z.object({ code: z.string().regex(/^\s*\d{6}\s*$/) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_code' });
    try {
      const user = await verifyPhoneCode(db, config, idParams.parse(request.params).id, body.data.code);
      setSession(reply, await createSession(db, user.id, config.sessionDays));
      return reply.code(201).send({ user: publicUser(user) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/auth/login', limited, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const user = await checkCredentials(db, parsed.data.email, parsed.data.password);
    if (!user) return reply.code(401).send({ error: 'invalid_credentials' });
    // La connexion reste possible depuis un appareil partagé, mais les comptes liés sont signalés.
    await recordSignals(db, user.id, requestSignals(request, config, parsed.data));
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

  // Tests de bout en bout : lire le dernier SMS « envoyé » (jamais en production).
  if (config.testFixtures && guard.sms instanceof ConsoleSms) {
    const sms = guard.sms;
    app.get('/api/test/sms', async (request, reply) => {
      const { phone } = z.object({ phone: z.string() }).parse(request.query);
      const text = sms.last.get(phone);
      return text ? { text } : reply.code(404).send({ error: 'no_sms' });
    });
  }
}
