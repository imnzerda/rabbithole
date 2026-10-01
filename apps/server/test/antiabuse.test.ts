import { afterEach, describe, expect, it } from 'vitest';
import { linkedAccounts } from '../src/auth/antiabuse.js';
import { canonicalEmail, ConsoleSms, DisposableDomains, Limiter, subnetOf, type CaptchaVerifier, type Guard } from '../src/auth/guard.js';
import { normalizePhone } from '../src/auth/phone.js';
import { testConfig, type ServerConfig } from '../src/config.js';
import { signup, signupPayload, startApp } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
afterEach(async () => {
  if (t) await t.app.close();
  t = null;
});

const guardCfg = (over: Partial<ServerConfig['guard']>) => ({ guard: { ...testConfig().guard, ...over } });

/** Inscription depuis une IP et un appareil donnés. */
const signupFrom = (name: string, opts: { hwid?: string; fp?: string; ip?: string; device?: string; body?: Record<string, unknown> } = {}) =>
  t!.app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: signupPayload(name, { ...(opts.hwid ? { hwid: opts.hwid } : {}), ...(opts.fp ? { fp: opts.fp } : {}), ...opts.body }),
    remoteAddress: opts.ip ?? '203.0.113.7',
    ...(opts.device ? { cookies: { rh_device: opts.device } } : {}),
  });

const post = (url: string, payload: Record<string, unknown>, ip = '203.0.113.7') => t!.app.inject({ method: 'POST', url, payload, remoteAddress: ip });

/** Inscription en attente → SMS → code : renvoie la réponse finale. */
async function verifyByPhone(sms: ConsoleSms, pendingId: string, phone: string) {
  const sent = await post(`/api/auth/signup/${pendingId}/phone`, { phone });
  expect(sent.statusCode, sent.body).toBe(200);
  const e164 = normalizePhone(phone, 'FR', ['FR']);
  const code = /\d{6}/.exec(sms.last.get('e164' in e164 ? e164.e164 : '')!)![0];
  return post(`/api/auth/signup/${pendingId}/verify`, { code });
}

describe('briques', () => {
  it('e-mail canonique : casse, alias « + » (tous domaines), points Gmail', () => {
    expect(canonicalEmail('John.Doe+rh@Gmail.com')).toBe('johndoe@gmail.com');
    expect(canonicalEmail('j.o.h.n.doe@googlemail.com')).toBe('johndoe@gmail.com');
    expect(canonicalEmail('Jean.Dupont+test@Orange.fr')).toBe('jean.dupont@orange.fr');
  });

  it('e-mails jetables : liste embarquée (plusieurs milliers de domaines), sous-domaines, ajouts manuels', () => {
    const list = new DisposableDomains({ disposableListUrl: null, disposableExtra: ['jetable.example'] });
    expect(list.size).toBeGreaterThan(1000);
    expect(list.isDisposableEmail('a@yopmail.com')).toBe(true);
    expect(list.isDisposableEmail('a@mx.mailinator.com')).toBe(true);
    expect(list.isDisposableEmail('a@jetable.example')).toBe(true);
    expect(list.isDisposableEmail('a@gmail.com')).toBe(false);
    expect(list.isDisposableEmail('a@orange.fr')).toBe(false);
  });

  it('sous-réseaux : /24 en IPv4, /64 en IPv6', () => {
    expect(subnetOf('203.0.113.77')).toBe('203.0.113.0/24');
    expect(subnetOf('::ffff:203.0.113.77')).toBe('203.0.113.0/24');
    expect(subnetOf('2001:db8:1:2:aaaa::1')).toBe('2001:0db8:0001:0002::/64');
  });

  it('limiteur : au-delà de la limite, blocage temporaire', () => {
    const l = new Limiter();
    for (let i = 0; i < 3; i++) expect(l.hit('k', 3, 60_000, 900_000, 1000 + i)).toBe(0);
    expect(l.hit('k', 3, 60_000, 900_000, 1010)).toBe(900);
    expect(l.hit('k', 3, 60_000, 900_000, 120_000)).toBeGreaterThan(0); // toujours bloqué après la fenêtre
    expect(l.hit('k', 3, 60_000, 900_000, 1_000_000)).toBe(0); // blocage levé
  });

  it('numéros : mobiles acceptés ; virtuels, surtaxés, fixes et pays hors liste refusés', () => {
    const fr = ['FR', 'US', 'DE'];
    expect(normalizePhone('06 12 34 56 78', 'FR', fr)).toEqual({ e164: '+33612345678' });
    expect(normalizePhone('+49 151 23456789', 'FR', fr)).toEqual({ e164: '+4915123456789' });
    expect(normalizePhone('+33 9 48 00 00 00', 'FR', fr)).toEqual({ error: 'virtual_phone' });
    expect(normalizePhone('+33 8 91 00 00 00', 'FR', fr)).toEqual({ error: 'invalid_phone' });
    expect(normalizePhone('+33 1 40 00 00 00', 'FR', fr)).toEqual({ error: 'invalid_phone' });
    expect(normalizePhone('+44 7700 900123', 'FR', fr)).toEqual({ error: 'invalid_phone' });
    expect(normalizePhone('+34 612 34 56 78', 'FR', fr)).toEqual({ error: 'phone_country' });
  });
});

describe('robots', () => {
  it('pot de miel rempli : inscription refusée', async () => {
    t = await startApp();
    const res = await signupFrom('robot', { body: { website: 'http://spam.example' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_input');
  });

  it('captcha : sans jeton valide, inscription refusée', async () => {
    const captcha: CaptchaVerifier = { enabled: true, verify: async (token) => token === 'jeton-valide' };
    t = await startApp({}, { captcha });
    expect((await signupFrom('sans')).json().error).toBe('captcha_failed');
    expect((await signupFrom('faux', { body: { captchaToken: 'faux' } })).json().error).toBe('captcha_failed');
    expect((await signupFrom('humain', { body: { captchaToken: 'jeton-valide' } })).statusCode).toBe(201);
  });

  it('débit : 3 tentatives par minute et par IP, puis blocage ; le sous-réseau a sa propre limite', async () => {
    t = await startApp(guardCfg({ signupPerIpPerMinute: 3, signupPerSubnetPerMinute: 5 }));
    for (let i = 0; i < 3; i++) expect((await signupFrom(`ip${i}`, { hwid: `gpu:modele-${i}`, ip: '198.51.100.1' })).statusCode).toBe(201);
    const blocked = await signupFrom('ip3', { hwid: 'gpu:modele-3', ip: '198.51.100.1' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe('too_many_attempts');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // Même sous-réseau, autre IP : 2 tentatives de plus atteignent la limite du /24.
    expect((await signupFrom('net1', { hwid: 'gpu:modele-n1', ip: '198.51.100.2' })).statusCode).toBe(201);
    expect((await signupFrom('net2', { hwid: 'gpu:modele-n2', ip: '198.51.100.3' })).statusCode).toBe(429);
    // Autre réseau : pas concerné.
    expect((await signupFrom('ailleurs', { hwid: 'gpu:modele-a', ip: '192.0.2.1' })).statusCode).toBe(201);
  });
});

describe('e-mails', () => {
  it('alias refusés : la même adresse avec « + » ou des points (Gmail) est déjà prise', async () => {
    t = await startApp();
    expect((await signupFrom('alpha', { hwid: 'gpu:alpha-1', body: { email: 'John.Doe@gmail.com' } })).statusCode).toBe(201);
    const alias = await signupFrom('bravo', { hwid: 'gpu:bravo-1', body: { email: 'johndoe+alt@googlemail.com' } });
    expect(alias.statusCode).toBe(409);
    expect(alias.json().error).toBe('email_taken');
    const plus = await signupFrom('charlie', { hwid: 'gpu:charlie', body: { email: 'john.doe+2@gmail.com' } });
    expect(plus.json().error).toBe('email_taken');
  });

  it('e-mails jetables refusés (liste à jour)', async () => {
    t = await startApp();
    for (const email of ['jetable@yopmail.com', 'jetable@10minutemail.com', 'jetable@guerrillamail.com']) {
      const res = await signupFrom('jetable', { body: { email } });
      expect(res.json().error, email).toBe('disposable_email');
    }
  });
});

describe('appareil', () => {
  it('même HWID depuis le même réseau : refusé, même si les cookies ont été effacés', async () => {
    t = await startApp();
    expect((await signupFrom('premier', { hwid: 'gpu:X|cpu:8' })).statusCode).toBe(201);
    const second = await signupFrom('second', { hwid: 'gpu:X|cpu:8' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('device_has_account');
  });

  it('même empreinte de navigateur depuis le même réseau : refusé', async () => {
    t = await startApp();
    await signupFrom('premier', { hwid: 'gpu:AAAA|cpu:4', fp: 'canvas:abc|audio:123' });
    expect((await signupFrom('second', { hwid: 'gpu:BBBB|cpu:4', fp: 'canvas:abc|audio:123' })).statusCode).toBe(409);
  });

  it('le cookie d’appareil suffit aussi, même avec un HWID différent', async () => {
    t = await startApp();
    const first = await signupFrom('premier', { hwid: 'gpu:AAAA|cpu:4' });
    const device = first.cookies.find((c) => c.name === 'rh_device')!.value;
    expect((await signupFrom('second', { hwid: 'gpu:BBBB|cpu:4', device })).statusCode).toBe(409);
  });

  it('mode strict : même HWID refusé quel que soit le réseau', async () => {
    t = await startApp({ hwidStrict: true });
    await signupFrom('strict-a', { hwid: 'gpu:Apple GPU', ip: '203.0.113.7' });
    expect((await signupFrom('strict-b', { hwid: 'gpu:Apple GPU', ip: '198.51.100.9' })).statusCode).toBe(409);
  });

  it('plusieurs appareils derrière la même IP : inscriptions acceptées, comptes liés', async () => {
    t = await startApp();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await signupFrom(`wifi${i}`, { hwid: `gpu:modele-${i}` });
      expect(res.statusCode).toBe(201);
      ids.push(res.json().user.id);
    }
    expect(await linkedAccounts(t.db, ids[0]!)).toEqual(expect.arrayContaining(ids.slice(1)));
  });

  it('se connecter depuis l’appareil d’un autre compte : autorisé, mais les comptes sont liés et signalés', async () => {
    t = await startApp();
    const a = await signup(t.app, 'foyer-a');
    const b = await signup(t.app, 'foyer-b');
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'foyer-b@example.com', password: 'motdepasse1', hwid: 'test-hwid:foyer-a' },
      cookies: { rh_device: a.device },
    });
    expect(login.statusCode).toBe(200);
    expect(await linkedAccounts(t.db, a.id)).toContain(b.id);
    const flags = await t.db.query<{ reason: string }>('SELECT reason FROM account_flags WHERE user_id = $1', [b.id]);
    expect(flags.map((f) => f.reason)).toContain('shared_device');
  });
});

describe('vérification par SMS', () => {
  const setup = async (over: Partial<ServerConfig> = {}, services: Partial<Guard> = {}) => {
    const sms = new ConsoleSms(() => {});
    t = await startApp(over, { sms, ...services });
    return sms;
  };

  it('appareil déjà vu sur un autre réseau : SMS demandé, puis compte créé et lié', async () => {
    const sms = await setup();
    const a = await signupFrom('iphone-a', { hwid: 'gpu:Apple GPU', ip: '203.0.113.7' });
    const pending = await signupFrom('iphone-b', { hwid: 'gpu:Apple GPU', ip: '198.51.100.9' });
    expect(pending.statusCode).toBe(202);
    expect(pending.json().verify).toBe('phone');
    expect(pending.cookies.find((c) => c.name === 'rh_session')).toBeUndefined();

    const done = await verifyByPhone(sms, pending.json().pendingId, '06 12 34 56 78');
    expect(done.statusCode).toBe(201);
    expect(done.cookies.find((c) => c.name === 'rh_session')).toBeDefined();
    const b = done.json().user.id as string;
    expect(await linkedAccounts(t!.db, a.json().user.id)).toContain(b);
    const [row] = await t!.db.query<{ phone_verified_at: unknown }>('SELECT phone_verified_at FROM users WHERE id = $1', [b]);
    expect(row!.phone_verified_at).not.toBeNull();
  });

  it('VPN ou proxy : SMS demandé ; refusé si les SMS sont désactivés', async () => {
    const vpn = { check: async () => ({ risky: true, type: 'VPN' }) };
    await setup({}, { ipReputation: vpn });
    expect((await signupFrom('vpn')).statusCode).toBe(202);
    await t!.app.close();
    await setup(guardCfg({ smsMode: 'off' }), { ipReputation: vpn });
    const res = await signupFrom('vpn');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('vpn_blocked');
  });

  it('mode « always » : chaque inscription passe par le SMS', async () => {
    await setup(guardCfg({ smsMode: 'always' }));
    expect((await signupFrom('toujours')).statusCode).toBe(202);
  });

  it('un numéro = un compte ; numéros virtuels refusés', async () => {
    const sms = await setup(guardCfg({ smsMode: 'always' }));
    const first = await signupFrom('num-a', { hwid: 'gpu:num-a1' });
    expect((await verifyByPhone(sms, first.json().pendingId, '+33 6 11 22 33 44')).statusCode).toBe(201);

    const second = (await signupFrom('num-b', { hwid: 'gpu:num-b1' })).json().pendingId as string;
    const taken = await post(`/api/auth/signup/${second}/phone`, { phone: '06 11 22 33 44' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe('phone_taken');
    const voip = await post(`/api/auth/signup/${second}/phone`, { phone: '09 48 00 00 00' });
    expect(voip.json().error).toBe('virtual_phone');
  });

  it('mauvais code : essais comptés, puis blocage', async () => {
    const sms = await setup(guardCfg({ smsMode: 'always' }));
    const id = (await signupFrom('code')).json().pendingId as string;
    await post(`/api/auth/signup/${id}/phone`, { phone: '06 55 44 33 22' });
    const good = /\d{6}/.exec(sms.last.get('+33655443322')!)![0];
    const wrong = good === '000000' ? '111111' : '000000';
    const first = await post(`/api/auth/signup/${id}/verify`, { code: wrong });
    expect(first.json()).toMatchObject({ error: 'bad_code', attemptsLeft: 4 });
    for (let i = 0; i < 4; i++) await post(`/api/auth/signup/${id}/verify`, { code: wrong });
    const locked = await post(`/api/auth/signup/${id}/verify`, { code: good });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe('too_many_attempts');
  });

  it('SMS limités par numéro et par heure', async () => {
    await setup(guardCfg({ smsMode: 'always', smsPerPhonePerHour: 2 }));
    const id = (await signupFrom('limite')).json().pendingId as string;
    expect((await post(`/api/auth/signup/${id}/phone`, { phone: '06 99 88 77 66' })).statusCode).toBe(200);
    expect((await post(`/api/auth/signup/${id}/phone`, { phone: '06 99 88 77 66' })).statusCode).toBe(200);
    const third = await post(`/api/auth/signup/${id}/phone`, { phone: '06 99 88 77 66' });
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toBe('sms_rate_limited');
  });

  it('inscription en attente inconnue ou expirée', async () => {
    await setup();
    const res = await post('/api/auth/signup/00000000-0000-0000-0000-000000000000/phone', { phone: '06 12 34 56 78' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('pending_expired');
  });
});

describe('confidentialité', () => {
  it('aucune IP, aucun identifiant d’appareil, aucun numéro stocké en clair', async () => {
    const sms = new ConsoleSms(() => {});
    t = await startApp(guardCfg({ smsMode: 'always' }), { sms });
    const pending = await signupFrom('prive', { hwid: 'test-hwid:prive', fp: 'test-fp:prive' });
    await verifyByPhone(sms, pending.json().pendingId, '06 12 34 56 78');

    const devices = await t.db.query<{ device_hash: string; kind: string }>('SELECT device_hash, kind FROM user_devices ORDER BY kind');
    expect(devices.map((d) => d.kind)).toEqual(['cookie', 'fp', 'hwid']);
    for (const d of devices) expect(d.device_hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify([
      await t.db.query('SELECT * FROM users'),
      await t.db.query('SELECT * FROM user_devices'),
      await t.db.query('SELECT * FROM user_ips'),
      await t.db.query('SELECT * FROM sms_sends'),
      await t.db.query('SELECT * FROM pending_signups'),
    ]);
    for (const secret of ['test-hwid', 'test-fp', '203.0.113.7', '612345678', '+33']) expect(dump, secret).not.toContain(secret);
  });
});
