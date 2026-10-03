import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { auth, signupPayload, signupWithKit, startApp, TestClient } from './helpers.js';

/**
 * Decks de référence, de bout en bout avec les vrais lots du set de base :
 * import des brouillons et des decks dans l'admin, publication, entraînement et fantômes.
 */
const PIPELINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tools', 'pipeline');
const read = (path: string) => JSON.parse(readFileSync(join(PIPELINE, path), 'utf8')) as Record<string, unknown>;

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (t) await t.app.close();
  t = null;
});

const ADMIN = 'decks@example.com';

async function setupBaseSet() {
  t = await startApp({ adminEmails: [ADMIN], ghostDelayMs: 60_000 });
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload('decks', { email: ADMIN }) });
  const token = res.cookies.find((c) => c.name === 'rh_session')!.value;
  const call = (method: 'GET' | 'POST', url: string, payload?: unknown) => t!.app.inject({ method, url, headers: auth(token), payload: payload as object });
  for (const lot of ['drafts/base_01.json', 'drafts/base_01_lot2.json']) {
    const r = (await call('POST', '/api/admin/cards/import', read(lot))).json();
    expect(r.skipped).toEqual([]);
  }
  return { call };
}

async function publishAll(call: Awaited<ReturnType<typeof setupBaseSet>>['call']) {
  const cards = (await call('GET', '/api/admin/cards?series=base_01')).json().cards as { id: string }[];
  for (const c of cards) {
    await call('POST', `/api/admin/cards/${c.id}/status`, { status: 'review' });
    expect((await call('POST', `/api/admin/cards/${c.id}/status`, { status: 'published' })).statusCode, c.id).toBe(200);
  }
  await call('POST', '/api/admin/series/base_01/status', { status: 'published' });
}

describe('decks de référence', () => {
  it('sans série publiée : les decks du prototype', async () => {
    t = await startApp();
    const decks = (await t.app.inject({ method: 'GET', url: '/api/decks/reference' })).json().decks;
    expect(decks).toHaveLength(5);
    expect(decks.every((d: { series: string }) => d.series === 'prototype')).toBe(true);
  });

  it('import dans l’admin (format du pipeline), publication : decks de la série en tête, jouables', async () => {
    const { call } = await setupBaseSet();
    const result = (await call('POST', '/api/admin/decks/import', read('decks/base_01.json'))).json();
    expect(result).toEqual({ imported: expect.arrayContaining(['base_01_d_bieber', 'base_01_d_marilyn']), invalid: [] });
    // Série encore en brouillon : pas encore proposés aux joueurs.
    expect((await call('GET', '/api/decks/reference')).json().decks.some((d: { series: string }) => d.series === 'base_01')).toBe(false);
    expect((await call('GET', '/api/admin/decks')).json().decks.filter((d: { series: string }) => d.series === 'base_01')).toHaveLength(5);

    await publishAll(call);
    const decks = (await call('GET', '/api/decks/reference')).json().decks;
    expect(decks.slice(0, 5).map((d: { series: string }) => d.series)).toEqual(Array(5).fill('base_01'));
    expect(decks[0].cards).toHaveLength(20);

    // Simulation dans l'admin avec les decks de référence.
    const sim = (await call('POST', '/api/admin/simulate', { a: { prebuilt: 'base_01_d_bieber' }, b: { prebuilt: 'base_01_d_cooper' }, games: 4 })).json();
    expect(sim.winsA + sim.winsB + sim.draws).toBe(4);
  }, 60_000);

  it('un deck invalide est refusé à l’import', async () => {
    const { call } = await setupBaseSet();
    const bad = { series: 'base_01', decks: [{ id: 'base_01_d_casse', name: { fr: 'Cassé' }, leader: 'l_justin_bieber', cards: ['einstein'] }] };
    const r = (await call('POST', '/api/admin/decks/import', bad)).json();
    expect(r.imported).toEqual([]);
    expect(r.invalid[0].id).toBe('base_01_d_casse');
  }, 60_000);

  it('fantôme de repli : un deck de référence de la série publiée', async () => {
    const { call } = await setupBaseSet();
    await call('POST', '/api/admin/decks/import', read('decks/base_01.json'));
    await publishAll(call);
    const { token } = await signupWithKit(t!.app, 'solo');
    const myDecks = (await t!.app.inject({ method: 'GET', url: '/api/decks', headers: auth(token) })).json().decks;
    const client = await TestClient.connect(t!.url, token);
    clients.push(client);
    await client.wait('hello');
    client.send({ t: 'queue', deckId: myDecks[0].id, mode: 'ghost' });
    const start = await client.wait('match_start');
    expect(start.opponent.ghost).toBe(true);
    expect(start.opponent.leader).toMatch(/^base_01_l_/);
  }, 60_000);
});
