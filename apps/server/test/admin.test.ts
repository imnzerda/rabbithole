import { afterEach, describe, expect, it } from 'vitest';
import { auth, signup, signupPayload, startApp } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
afterEach(async () => {
  if (t) await t.app.close();
  t = null;
});

const ADMIN = 'chef@example.com';

async function setup() {
  t = await startApp({ adminEmails: [ADMIN] });
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload('chef', { email: ADMIN }) });
  expect(res.json().user.role).toBe('admin');
  const token = res.cookies.find((c) => c.name === 'rh_session')!.value;
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => t!.app.inject({ method, url, headers: auth(token), payload: payload as object });
  return { call };
}

const image = (accepted: boolean) => ({
  file: 'Portrait.jpg',
  filePage: 'https://commons.wikimedia.org/wiki/File:Portrait.jpg',
  url: 'https://upload.wikimedia.org/portrait.jpg',
  thumbUrl: 'https://upload.wikimedia.org/thumb/portrait.jpg',
  author: 'Jane Doe',
  license: accepted ? 'CC BY-SA 4.0' : 'CC BY-NC 2.0',
  licenseUrl: null,
  accepted,
  personalityRights: false,
});

const run = {
  series: 'base_01',
  candidates: [
    {
      qid: 'Q100',
      kind: 'person',
      categories: ['science'],
      labels: { fr: 'Marie Test', en: 'Marie Test' },
      descriptions: { fr: 'physicienne' },
      countries: ['FR'],
      sitelinks: 120,
      score: { total: 97, iconic: true, meetsThreshold: true },
      policy: { status: 'ok', reasons: [] },
      flags: {},
      imageInfo: image(true),
    },
    {
      qid: 'Q200',
      kind: 'person',
      categories: ['crimes_scandales'],
      labels: { fr: 'Gangster Test', en: 'Test Gangster' },
      descriptions: { en: 'gangster' },
      countries: ['US'],
      sitelinks: 60,
      score: { total: 80, iconic: false, meetsThreshold: false },
      policy: { status: 'needs_review', reasons: ['convicted'] },
      flags: { sensitive: true },
      imageInfo: image(false),
    },
    {
      qid: 'Q300',
      kind: 'person',
      categories: ['musique'],
      labels: { fr: 'Enfant Star' },
      descriptions: {},
      countries: [],
      sitelinks: 90,
      score: { total: 99, iconic: true, meetsThreshold: true },
      policy: { status: 'excluded', reasons: ['minor_at_career_start'] },
      flags: {},
      imageInfo: null,
    },
  ],
};

describe('outil d’administration', () => {
  it('réservé aux admins (ADMIN_EMAILS) ; les autres comptes reçoivent 403', async () => {
    await setup();
    const player = await signup(t!.app, 'joueur');
    expect((await t!.app.inject({ method: 'GET', url: '/api/admin/overview', headers: auth(player.token) })).statusCode).toBe(403);
    expect((await t!.app.inject({ method: 'GET', url: '/api/admin/overview' })).statusCode).toBe(401);
  });

  it('import des candidats du pipeline, filtres, décision conservée à la réimportation', async () => {
    const { call } = await setup();
    expect((await call('POST', '/api/admin/candidates/import', run)).json()).toEqual({ imported: 3, updated: 0 });
    const all = (await call('GET', '/api/admin/candidates')).json();
    expect(all.total).toBe(3);
    expect(all.candidates[0].qid).toBe('Q300'); // trié par score
    expect((await call('GET', '/api/admin/candidates?policy=needs_review')).json().candidates.map((c: { qid: string }) => c.qid)).toEqual(['Q200']);
    expect((await call('GET', '/api/admin/candidates?q=marie')).json().total).toBe(1);

    await call('POST', '/api/admin/candidates/Q200/status', { status: 'rejected' });
    expect((await call('POST', '/api/admin/candidates/import', run)).json()).toEqual({ imported: 0, updated: 3 });
    expect((await call('GET', '/api/admin/candidates?status=rejected')).json().candidates[0].qid).toBe('Q200');
  });

  it('candidat → brouillon de carte (nom, catégories, image créditée) ; un sujet exclu ne devient jamais une carte', async () => {
    const { call } = await setup();
    await call('POST', '/api/admin/candidates/import', run);
    expect((await call('POST', '/api/admin/series', { id: 'base_01', type: 'base', name: { fr: 'Set de base', en: 'Base set' } })).statusCode).toBe(201);

    const excluded = await call('POST', '/api/admin/candidates/Q300/card', { series: 'base_01' });
    expect(excluded.statusCode).toBe(409);
    expect(excluded.json().error).toBe('policy_excluded');

    const created = await call('POST', '/api/admin/candidates/Q100/card', { series: 'base_01' });
    expect(created.statusCode).toBe(201);
    const card = created.json().card;
    expect(card).toMatchObject({ id: 'base_01_marie_test', wikidataId: 'Q100', categories: ['science'], rarity: 'iconique', country: 'FR', image: { fallback: false } });
    const detail = (await call('GET', `/api/admin/cards/${card.id}`)).json();
    expect(detail.status).toBe('draft');
    expect(detail.images[0]).toMatchObject({ author: 'Jane Doe', license: 'CC BY-SA 4.0' });
    expect(detail.errors).toEqual([]);
    expect(detail.budget.verdict).toBe('ok');
    expect((await call('GET', '/api/admin/candidates?status=carded')).json().candidates[0].cardId).toBe(card.id);
  });

  it('édition validée par le moteur ; publication : transitions, politique de contenu, catalogue mis à jour', async () => {
    const { call } = await setup();
    await call('POST', '/api/admin/candidates/import', run);
    await call('POST', '/api/admin/series', { id: 'base_01', type: 'base', name: { fr: 'Set de base', en: 'Base set' } });
    const card = (await call('POST', '/api/admin/candidates/Q200/card', { series: 'base_01' })).json().card;
    // Image refusée (NC) : carte typographique.
    expect(card.image.fallback).toBe(true);

    const bad = await call('PUT', `/api/admin/cards/${card.id}`, { def: { ...card, cost: 42 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details).toContain('cost invalide (0 à 10)');
    const good = await call('PUT', `/api/admin/cards/${card.id}`, { def: { ...card, power: 5, keywords: ['bloqueur'], flavor: { fr: 'Toujours un coup d’avance.' } } });
    expect(good.json().version).toBe(2);

    expect((await call('POST', `/api/admin/cards/${card.id}/status`, { status: 'published' })).json().error).toBe('invalid_transition');
    await call('POST', `/api/admin/cards/${card.id}/status`, { status: 'review' });
    const blocked = await call('POST', `/api/admin/cards/${card.id}/status`, { status: 'published' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().details).toContain('politique de contenu : validation humaine requise');

    expect((await call('POST', `/api/admin/cards/${card.id}/clear-policy`, { note: '' })).statusCode).toBe(400);
    await call('POST', `/api/admin/cards/${card.id}/clear-policy`, { note: 'Faits publics, carte sur la carrière, sans victime.' });
    const before = t!.catalog.current.version;
    expect((await call('POST', `/api/admin/cards/${card.id}/status`, { status: 'published' })).statusCode).toBe(200);
    // Série encore en brouillon : la carte n'est pas jouable.
    expect(t!.catalog.current.ctx.cards[card.id]).toBeUndefined();
    await call('POST', '/api/admin/series/base_01/status', { status: 'published' });
    expect(t!.catalog.current.ctx.cards[card.id]).toMatchObject({ power: 5, keywords: ['bloqueur'] });
    expect(t!.catalog.current.version).not.toBe(before);

    // Retrait : disparaît du catalogue.
    await call('POST', `/api/admin/cards/${card.id}/status`, { status: 'retired' });
    expect(t!.catalog.current.ctx.cards[card.id]).toBeUndefined();

    const actions = (await call('GET', '/api/admin/audit')).json().entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['candidates.import', 'card.create_from_candidate', 'card.save', 'card.clear_policy', 'card.published', 'series.published', 'card.retired']));
  });

  it('image retirée en un clic : la carte passe en typographique', async () => {
    const { call } = await setup();
    await call('POST', '/api/admin/candidates/import', run);
    await call('POST', '/api/admin/series', { id: 'base_01', type: 'base', name: { fr: 'Set de base', en: 'Base set' } });
    const card = (await call('POST', '/api/admin/candidates/Q100/card', { series: 'base_01' })).json().card;
    const img = (await call('GET', `/api/admin/cards/${card.id}`)).json().images[0];
    await call('POST', `/api/admin/cards/${card.id}/images/${img.id}`, { active: false });
    expect((await call('GET', `/api/admin/cards/${card.id}`)).json().def.image).toEqual({ assetId: null, fallback: true });
  });

  it('aperçu de l’éditeur, budget du catalogue, simulations IA contre IA', async () => {
    const { call } = await setup();
    const proto = t!.catalog.current.collectibles.find((c) => c.type === 'character')!;
    const p = (await call('POST', '/api/admin/cards/preview', { def: { ...proto, power: 20 } })).json();
    expect(p.errors).toEqual([]);
    expect(p.budget.verdict).toBe('strong');
    expect(p.text.length).toBeGreaterThanOrEqual(0);
    expect((await call('POST', '/api/admin/cards/preview', { def: { ...proto, categories: [] } })).json().errors).toContain('1 ou 2 catégories requises');

    const budget = (await call('GET', '/api/admin/budget')).json().cards;
    expect(budget.length).toBe(52);

    const decks = (await call('GET', '/api/admin/decks')).json().decks;
    const sim = (await call('POST', '/api/admin/simulate', { a: { prebuilt: decks[0].id }, b: { prebuilt: decks[1].id }, games: 6 })).json();
    expect(sim.winsA + sim.winsB + sim.draws).toBe(6);
  });
});
