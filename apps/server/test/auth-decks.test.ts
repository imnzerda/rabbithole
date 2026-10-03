import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { auth, signup, signupPayload, signupWithKit, startApp } from './helpers.js';

let t: App & { url: string };
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.app.close();
});

describe('comptes', () => {
  it("inscription : cookie de session httpOnly, aucune carte offerte, boosters de bienvenue à ouvrir", async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload('alice') });
    expect(res.statusCode).toBe(201);
    const cookie = res.cookies.find((c) => c.name === 'rh_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(res.json().user).toMatchObject({ email: 'alice@example.com', displayName: 'alice', country: 'FR', starterLeader: null });
    expect(JSON.stringify(res.json())).not.toMatch(/password|birth/);

    const headers = auth(cookie.value);
    expect((await t.app.inject({ method: 'GET', url: '/api/collection', headers })).json().cards).toEqual([]);
    expect((await t.app.inject({ method: 'GET', url: '/api/decks', headers })).json().decks).toEqual([]);
    const wallet = (await t.app.inject({ method: 'GET', url: '/api/wallet', headers })).json().wallet;
    expect(wallet).toEqual({ coins: 0, gems: 0, freeBoosters: 6 });
  });

  it("aucune condition d'âge : ni date de naissance, ni case à cocher", async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload('bob') });
    expect(res.statusCode).toBe(201);
    const [row] = await t.db.query<Record<string, unknown>>('SELECT * FROM users WHERE email = $1', ['bob@example.com']);
    expect(Object.keys(row!).filter((k) => /birth|age/.test(k))).toEqual([]);
  });

  it('entrées invalides', async () => {
    for (const bad of [{ email: 'pas-un-email' }, { password: 'court' }, { country: 'France' }, { locale: 'xx' }, { displayName: 'x' }]) {
      const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload('carol', bad) });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('connexion, même erreur pour un mauvais mot de passe ou un compte inconnu, déconnexion', async () => {
    const bad = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'alice@example.com', password: 'faux-mot' } });
    const unknown = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@example.com', password: 'faux-mot' } });
    expect(bad.statusCode).toBe(401);
    expect(unknown.json()).toEqual(bad.json());

    const ok = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'Alice@Example.com', password: 'motdepasse1' } });
    expect(ok.statusCode).toBe(200);
    const token = ok.cookies.find((c) => c.name === 'rh_session')!.value;
    await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth(token) });
    expect((await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })).statusCode).toBe(401);
  });

  it('session : 200 avec user null sans connexion ; routes protégées : 401', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/session' });
    expect(res.json()).toEqual({ user: null });
    for (const url of ['/api/me', '/api/decks', '/api/collection', '/api/matches', '/api/wallet', '/api/boosters']) {
      expect((await t.app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
  });
});

describe('decks', () => {
  it('créer, modifier, supprimer ; validation par le moteur et par la collection', async () => {
    const { token } = await signupWithKit(t.app);
    const base = (await t.app.inject({ method: 'GET', url: '/api/decks', headers: auth(token) })).json().decks[0];

    const created = await t.app.inject({ method: 'POST', url: '/api/decks', headers: auth(token), payload: { name: 'Mon deck', leaderId: base.leaderId, cardIds: base.cardIds } });
    expect(created.statusCode).toBe(201);
    const id = created.json().deck.id;

    const short = await t.app.inject({ method: 'PUT', url: `/api/decks/${id}`, headers: auth(token), payload: { name: 'Trop court', leaderId: base.leaderId, cardIds: base.cardIds.slice(1) } });
    expect(short.statusCode).toBe(400);
    expect(short.json().errors.join()).toContain('20 cartes');

    const three = [...base.cardIds.slice(0, 18), base.cardIds[0], base.cardIds[0]];
    const res = await t.app.inject({ method: 'PUT', url: `/api/decks/${id}`, headers: auth(token), payload: { name: 'x', leaderId: base.leaderId, cardIds: three } });
    expect(res.json().errors.join()).toContain('Pas assez');

    const other = await signup(t.app);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/decks/${id}`, headers: auth(other.token) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/decks/${id}`, headers: auth(token) })).statusCode).toBe(200);
  });

  it('un nouveau joueur ne peut pas enregistrer un deck avec des cartes qu’il ne possède pas', async () => {
    const { token } = await signup(t.app);
    const kit = await signupWithKit(t.app);
    const deck = (await t.app.inject({ method: 'GET', url: '/api/decks', headers: auth(kit.token) })).json().decks[0];
    const res = await t.app.inject({ method: 'POST', url: '/api/decks', headers: auth(token), payload: { name: 'Copie', leaderId: deck.leaderId, cardIds: deck.cardIds } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.join()).toContain('Leader non possédé');
  });
});
