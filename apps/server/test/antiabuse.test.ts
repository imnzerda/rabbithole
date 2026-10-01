import { afterEach, describe, expect, it } from 'vitest';
import { linkedAccounts } from '../src/auth/antiabuse.js';
import { signup, signupPayload, startApp } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
afterEach(async () => {
  if (t) await t.app.close();
  t = null;
});

const signupFrom = (name: string, opts: { hwid?: string; ip?: string; device?: string } = {}) =>
  t!.app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: signupPayload(name, opts.hwid ? { hwid: opts.hwid } : {}),
    remoteAddress: opts.ip ?? '203.0.113.7',
    ...(opts.device ? { cookies: { rh_device: opts.device } } : {}),
  });

describe('anti-double compte', () => {
  it('un appareil ne crée qu’un compte : même HWID depuis le même réseau, même si les cookies ont été effacés', async () => {
    t = await startApp();
    expect((await signupFrom('premier', { hwid: 'gpu:X|cpu:8' })).statusCode).toBe(201);
    const second = await signupFrom('second', { hwid: 'gpu:X|cpu:8' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('device_has_account');
  });

  it('le cookie d’appareil suffit aussi, même avec un HWID différent', async () => {
    t = await startApp();
    const first = await signupFrom('premier', { hwid: 'gpu:AAAA|cpu:4' });
    const device = first.cookies.find((c) => c.name === 'rh_device')!.value;
    const second = await signupFrom('second', { hwid: 'gpu:BBBB|cpu:4', device });
    expect(second.statusCode).toBe(409);
  });

  it('même HWID depuis un autre réseau (téléphones du même modèle) : inscription acceptée, comptes liés ; refusée en mode strict', async () => {
    t = await startApp();
    const a = await signupFrom('iphone-a', { hwid: 'gpu:Apple GPU', ip: '203.0.113.7' });
    const b = await signupFrom('iphone-b', { hwid: 'gpu:Apple GPU', ip: '198.51.100.9' });
    expect(b.statusCode).toBe(201);
    expect(await linkedAccounts(t.db, a.json().user.id)).toContain(b.json().user.id);
    await t.app.close();

    t = await startApp({ hwidStrict: true });
    await signupFrom('strict-a', { hwid: 'gpu:Apple GPU', ip: '203.0.113.7' });
    expect((await signupFrom('strict-b', { hwid: 'gpu:Apple GPU', ip: '198.51.100.9' })).statusCode).toBe(409);
  });

  it('plus de plafond par réseau : plusieurs appareils derrière la même IP peuvent s’inscrire, mais sont liés', async () => {
    t = await startApp();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await signupFrom(`wifi${i}`, { hwid: `gpu:modele-${i}` });
      expect(res.statusCode).toBe(201);
      ids.push(res.json().user.id);
    }
    expect(await linkedAccounts(t.db, ids[0]!)).toEqual(expect.arrayContaining(ids.slice(1)));
    const flags = await t.db.query<{ reason: string }>('SELECT DISTINCT reason FROM account_flags');
    expect(flags.map((f) => f.reason)).toEqual(['shared_ip']);
  });

  it('e-mails jetables refusés', async () => {
    t = await startApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload('jetable', { email: 'jetable@yopmail.com' }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('disposable_email');
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

  it('aucune IP ni aucun identifiant d’appareil stocké en clair', async () => {
    t = await startApp();
    const a = await signup(t.app, 'prive');
    const devices = await t.db.query<{ device_hash: string; kind: string }>('SELECT device_hash, kind FROM user_devices WHERE user_id = $1 ORDER BY kind', [a.id]);
    expect(devices.map((d) => d.kind)).toEqual(['cookie', 'hwid']);
    for (const d of devices) {
      expect(d.device_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(d.device_hash).not.toContain(a.device);
    }
    const [ip] = await t.db.query<{ ip_hash: string }>('SELECT ip_hash FROM user_ips WHERE user_id = $1', [a.id]);
    expect(ip!.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify(await t.db.query('SELECT * FROM user_devices'));
    expect(dump).not.toContain('test-hwid');
  });
});
