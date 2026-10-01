import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { ageOn } from '../src/auth/accounts.js';
import { auth, birthDateForAge, signup, startApp } from './helpers.js';

let t: App & { url: string };
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.app.close();
});

const signupPayload = (over: Record<string, unknown> = {}) => ({
  email: 'alice@example.com',
  password: 'motdepasse1',
  displayName: 'Alice',
  birthDate: '1990-05-20',
  country: 'FR',
  locale: 'fr',
  ...over,
});

describe('âge', () => {
  it('âge révolu, anniversaire compris', () => {
    expect(ageOn('2000-06-15', new Date('2021-06-14T12:00:00Z'))).toBe(20);
    expect(ageOn('2000-06-15', new Date('2021-06-15T12:00:00Z'))).toBe(21);
    expect(ageOn('2000-02-29', new Date('2021-02-28T12:00:00Z'))).toBe(20);
  });
});

describe('comptes', () => {
  it('inscription : cookie de session httpOnly, kit de départ (Leaders, cartes, 5 decks)', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload() });
    expect(res.statusCode).toBe(201);
    const cookie = res.cookies.find((c) => c.name === 'rh_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(res.json().user).toMatchObject({ email: 'alice@example.com', displayName: 'Alice', country: 'FR' });
    expect(JSON.stringify(res.json())).not.toContain('password');

    const me = await t.app.inject({ method: 'GET', url: '/api/me', cookies: { rh_session: cookie.value } });
    expect(me.statusCode).toBe(200);
    const collection = await t.app.inject({ method: 'GET', url: '/api/collection', headers: auth(cookie.value) });
    expect(collection.json().cards).toHaveLength(55);
    const decks = await t.app.inject({ method: 'GET', url: '/api/decks', headers: auth(cookie.value) });
    expect(decks.json().decks).toHaveLength(5);
  });

  it('accès refusé avant 21 ans ; accepté le jour des 21 ans', async () => {
    const young = await t.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: signupPayload({ email: 'young@example.com', birthDate: birthDateForAge(21, 1) }),
    });
    expect(young.statusCode).toBe(403);
    expect(young.json()).toEqual({ error: 'too_young', minAge: 21 });
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: signupPayload({ email: 'exactly21@example.com', birthDate: birthDateForAge(21) }),
    });
    expect(ok.statusCode).toBe(201);
  });

  it('e-mail déjà utilisé (insensible à la casse), entrées invalides', async () => {
    const dup = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload({ email: 'ALICE@example.com' }) });
    expect(dup.statusCode).toBe(409);
    for (const bad of [{ email: 'pas-un-email' }, { password: 'court' }, { birthDate: '1990-02-31' }, { country: 'France' }, { locale: 'xx' }]) {
      const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload({ email: 'x@example.com', ...bad }) });
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
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(me.statusCode).toBe(401);
  });

  it('session : 200 avec user null sans connexion', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/session' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
  });

  it('routes protégées sans session : 401', async () => {
    for (const url of ['/api/me', '/api/decks', '/api/collection', '/api/matches']) {
      expect((await t.app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
  });
});

describe('decks', () => {
  it('créer, modifier, supprimer ; validation par le moteur et par la collection', async () => {
    const { token } = await signup(t.app);
    const decks = (await t.app.inject({ method: 'GET', url: '/api/decks', headers: auth(token) })).json().decks;
    const base = decks[0];

    const created = await t.app.inject({
      method: 'POST',
      url: '/api/decks',
      headers: auth(token),
      payload: { name: 'Mon deck', leaderId: base.leaderId, cardIds: base.cardIds },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().deck.id;

    const short = await t.app.inject({
      method: 'PUT',
      url: `/api/decks/${id}`,
      headers: auth(token),
      payload: { name: 'Trop court', leaderId: base.leaderId, cardIds: base.cardIds.slice(1) },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().errors.join()).toContain('20 cartes');

    // 3 exemplaires : interdit par les règles ET non possédé.
    const three = [...base.cardIds.slice(0, 18), base.cardIds[0], base.cardIds[0]];
    const res = await t.app.inject({ method: 'PUT', url: `/api/decks/${id}`, headers: auth(token), payload: { name: 'x', leaderId: base.leaderId, cardIds: three } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.join()).toContain('Pas assez');

    const renamed = await t.app.inject({ method: 'PUT', url: `/api/decks/${id}`, headers: auth(token), payload: { name: 'Renommé', leaderId: base.leaderId, cardIds: base.cardIds } });
    expect(renamed.json().deck.name).toBe('Renommé');

    // Un autre joueur ne voit ni ne modifie ce deck.
    const other = await signup(t.app);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/decks/${id}`, headers: auth(other.token) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/decks/${id}`, headers: auth(token) })).statusCode).toBe(200);
  });

  it('catalogue public', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/catalog' });
    expect(res.json().cards.length).toBeGreaterThan(50);
    expect(res.json().rules.deckSize).toBe(20);
  });
});
