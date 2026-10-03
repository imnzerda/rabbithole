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
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => t!.app.inject({ method, url, headers: auth(token), payload: payload as object });
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
    // Carte « à revoir » (condamné) : l'information reste affichée, mais ne bloque plus la publication.
    expect((await call('GET', `/api/admin/cards/${card.id}`)).json().policy).toEqual({ status: 'needs_review', reasons: ['convicted'] });
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
    expect(actions).toEqual(expect.arrayContaining(['candidates.import', 'card.create_from_candidate', 'card.save', 'card.published', 'series.published', 'card.retired']));
  });

  it('enlever une carte : effacée si jamais publiée (candidat de nouveau disponible), retirée du jeu sinon', async () => {
    const { call } = await setup();
    await call('POST', '/api/admin/candidates/import', run);
    await call('POST', '/api/admin/series', { id: 'base_01', type: 'base', name: { fr: 'Set de base', en: 'Base set' } });
    await call('POST', '/api/admin/series/base_01/status', { status: 'published' });
    const draft = (await call('POST', '/api/admin/candidates/Q100/card', { series: 'base_01' })).json().card;
    expect((await call('DELETE', `/api/admin/cards/${draft.id}`)).json()).toEqual({ result: 'deleted' });
    expect((await call('GET', `/api/admin/cards/${draft.id}`)).statusCode).toBe(404);
    expect((await call('GET', '/api/admin/candidates?q=Q100')).json().candidates[0]).toMatchObject({ status: 'new', cardId: null });

    // Publiée puis remise en brouillon : des joueurs ont pu l'obtenir, elle n'est jamais effacée.
    const card = (await call('POST', '/api/admin/candidates/Q100/card', { series: 'base_01' })).json().card;
    await call('POST', `/api/admin/cards/${card.id}/status`, { status: 'review' });
    await call('POST', `/api/admin/cards/${card.id}/status`, { status: 'published' });
    expect(t!.catalog.current.ctx.cards[card.id]).toBeDefined();
    const removed = await call('DELETE', `/api/admin/cards/${card.id}`);
    expect(removed.json()).toEqual({ result: 'retired' });
    expect(t!.catalog.current.ctx.cards[card.id]).toBeUndefined();
    expect((await call('GET', `/api/admin/cards/${card.id}`)).json().status).toBe('retired');
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

  it('import d’un lot de brouillons : lié au candidat (politique, image), sujets exclus et cartes invalides refusés', async () => {
    const { call } = await setup();
    await call('POST', '/api/admin/candidates/import', run);
    await call('POST', '/api/admin/series', { id: 'base_01', type: 'base', name: { fr: 'Set de base', en: 'Base set' } });
    const card = (over: Record<string, unknown>) => ({
      type: 'character', categories: ['science'], cost: 2, power: 3, counter: 1, rarity: 'basique', series: 'x', keywords: [], effects: [],
      name: { fr: 'Carte', en: 'Card' }, flavor: { fr: 'Texte.' }, ...over,
    });
    const res = (
      await call('POST', '/api/admin/cards/import', {
        series: 'base_01',
        cards: [
          card({ id: 'base_01_marie', wikidataId: 'Q100' }),
          card({ id: 'base_01_enfant', wikidataId: 'Q300', categories: ['musique'] }),
          card({ id: 'base_01_meme', name: { fr: 'Le mème' }, categories: ['internet'] }),
          card({ id: 'base_01_casse', cost: 99 }),
        ],
      })
    ).json();
    expect(res.created).toEqual(['base_01_marie', 'base_01_meme']);
    expect(res.skipped.map((x: { id: string; reason: string }) => [x.id, x.reason])).toEqual([
      ['base_01_enfant', 'policy_excluded'],
      ['base_01_casse', 'invalid_card'],
    ]);
    const marie = (await call('GET', '/api/admin/cards/base_01_marie')).json();
    expect(marie).toMatchObject({ status: 'draft', series: 'base_01', policy: { status: 'ok' }, def: { image: { fallback: false } } });
    expect(marie.images[0].author).toBe('Jane Doe');
    expect((await call('GET', '/api/admin/cards/base_01_meme')).json().policy).toMatchObject({ status: 'needs_review', reasons: ['manual'] });
    // Réimporter ne crée pas de doublon.
    const again = (await call('POST', '/api/admin/cards/import', { series: 'base_01', cards: [card({ id: 'base_01_marie' })] })).json();
    expect(again.skipped[0].reason).toBe('exists');
  });
});
