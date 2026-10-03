import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { auth, signup, signupPayload, startApp } from './helpers.js';

let t: App & { url: string };
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.app.close();
});

const get = (url: string, token: string) => t.app.inject({ method: 'GET', url, headers: auth(token) });
const post = (url: string, token: string, payload?: unknown) => t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as object });
const del = (url: string, token: string) => t.app.inject({ method: 'DELETE', url, headers: auth(token) });
const setQty = (id: string, cardId: string, quantity: number) =>
  t.db.query(
    `INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [id, cardId, quantity],
  );
const qty = async (id: string, cardId: string) =>
  (await t.db.query<{ quantity: number }>('SELECT quantity FROM collections WHERE user_id = $1 AND card_id = $2', [id, cardId]))[0]?.quantity ?? 0;

/** Inscription avec un pseudo choisi (les pseudos ne sont pas uniques, les e-mails si). */
let named = 0;
async function signupAs(displayName: string): Promise<{ token: string; id: string }> {
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload(`pseudo${++named}`, { displayName }) });
  expect(res.statusCode).toBe(201);
  return { token: res.cookies.find((c) => c.name === 'rh_session')!.value, id: res.json().user.id };
}

async function friends(): Promise<[{ token: string; id: string }, { token: string; id: string }]> {
  const a = await signup(t.app);
  const b = await signup(t.app);
  const code = (await get('/api/friends', b.token)).json().code as string;
  expect((await post('/api/friends', a.token, { code })).statusCode).toBe(200);
  expect((await post(`/api/friends/${a.id}/accept`, b.token)).statusCode).toBe(200);
  return [a, b];
}

describe('amis', () => {
  it('demande par code ami, acceptation, listes ; pas de délai avant d’être amis', async () => {
    const a = await signup(t.app, 'Alice');
    const b = await signup(t.app, 'Bob');
    const codeB = (await get('/api/friends', b.token)).json().code as string;
    expect(codeB).toMatch(/^[0-9A-F]{8}$/);

    const sent = await post('/api/friends', a.token, { code: codeB.toLowerCase() });
    expect(sent.json()).toMatchObject({ id: b.id, name: 'Bob', accepted: false });
    expect((await get('/api/friends', a.token)).json().outgoing.map((f: { id: string }) => f.id)).toEqual([b.id]);
    expect((await get('/api/friends', b.token)).json().incoming.map((f: { id: string }) => f.id)).toEqual([a.id]);
    expect((await post('/api/friends', a.token, { code: codeB })).json().error).toBe('already_requested');

    expect((await post(`/api/friends/${b.id}/accept`, a.token)).json().error).toBe('no_request');
    expect((await post(`/api/friends/${a.id}/accept`, b.token)).statusCode).toBe(200);
    const listA = (await get('/api/friends', a.token)).json();
    expect(listA.friends).toEqual([expect.objectContaining({ id: b.id, name: 'Bob' })]);
    expect(listA.outgoing).toEqual([]);
    expect((await post('/api/friends', b.token, { code: listA.code })).json().error).toBe('already_friends');

    expect((await del(`/api/friends/${b.id}`, a.token)).statusCode).toBe(200);
    expect((await get('/api/friends', b.token)).json().friends).toEqual([]);
  });

  it('par pseudo s’il est unique ; demandes croisées = amis ; refus : soi-même, inconnu, homonymes', async () => {
    const a = await signupAs('Pseudo Unique');
    const b = await signupAs('Autre Joueur');
    expect((await post('/api/friends', b.token, { name: 'pseudo unique' })).json().accepted).toBe(false);
    // A demande à son tour : la demande de B est acceptée.
    expect((await post('/api/friends', a.token, { name: 'Autre Joueur' })).json().accepted).toBe(true);
    expect((await get('/api/friends', a.token)).json().friends).toHaveLength(1);

    expect((await post('/api/friends', a.token, { name: 'Pseudo Unique' })).json().error).toBe('self');
    expect((await post('/api/friends', a.token, { name: 'Personne' })).statusCode).toBe(404);
    await signupAs('Homonyme');
    await signupAs('Homonyme');
    expect((await post('/api/friends', a.token, { name: 'Homonyme' })).json().error).toBe('ambiguous_name');
    expect((await post('/api/friends', a.token, {})).statusCode).toBe(400);
  });

  it('collection d’un ami visible, pas celle d’un inconnu', async () => {
    const [a, b] = await friends();
    await setQty(b.id, 'proto_buteur', 3);
    expect((await get(`/api/friends/${b.id}/collection`, a.token)).json().cards).toContainEqual({ cardId: 'proto_buteur', quantity: 3 });
    const stranger = await signup(t.app);
    expect((await get(`/api/friends/${b.id}/collection`, stranger.token)).statusCode).toBe(403);
  });
});

describe('échanges', () => {
  const propose = (from: { token: string }, toUserId: string, offered: [string, number][], requested: [string, number][]) =>
    post('/api/trades', from.token, {
      toUserId,
      offered: offered.map(([cardId, quantity]) => ({ cardId, quantity })),
      requested: requested.map(([cardId, quantity]) => ({ cardId, quantity })),
    });

  it('plusieurs cartes de chaque côté, raretés libres : proposé, accepté, tout change de main d’un coup', async () => {
    const [a, b] = await friends();
    await setQty(a.id, 'proto_chevalier', 3);
    await setQty(a.id, 'proto_buteur', 1);
    await setQty(b.id, 'proto_empereur', 1);
    const proposed = await propose(a, b.id, [
      ['proto_chevalier', 2],
      ['proto_buteur', 1],
    ], [['proto_empereur', 1]]);
    expect(proposed.statusCode).toBe(200);
    const trade = proposed.json().trade;
    expect(trade).toMatchObject({
      status: 'pending',
      fromUser: { id: a.id },
      toUser: { id: b.id },
      offered: [
        { cardId: 'proto_buteur', quantity: 1 },
        { cardId: 'proto_chevalier', quantity: 2 },
      ],
      requested: [{ cardId: 'proto_empereur', quantity: 1 }],
    });
    // Rien ne bouge avant l'acceptation.
    expect(await qty(a.id, 'proto_chevalier')).toBe(3);
    expect((await get('/api/trades', b.token)).json().incoming.map((x: { id: string }) => x.id)).toEqual([trade.id]);

    // Seul le destinataire accepte.
    expect((await post(`/api/trades/${trade.id}/accept`, a.token)).json().error).toBe('not_your_trade');
    expect((await post(`/api/trades/${trade.id}/accept`, b.token)).json().trade.status).toBe('accepted');
    expect(await qty(a.id, 'proto_chevalier')).toBe(1);
    expect(await qty(a.id, 'proto_buteur')).toBe(0);
    expect(await qty(a.id, 'proto_empereur')).toBe(1);
    expect(await qty(b.id, 'proto_chevalier')).toBe(2);
    expect(await qty(b.id, 'proto_buteur')).toBe(1);
    expect(await qty(b.id, 'proto_empereur')).toBe(0);
    expect((await post(`/api/trades/${trade.id}/accept`, b.token)).json().error).toBe('trade_closed');
    // Aucune monnaie en jeu.
    expect((await get('/api/wallet', a.token)).json().wallet).toMatchObject({ coins: 0, gems: 0 });
  });

  it('don (rien en retour) et demande de don', async () => {
    const [a, b] = await friends();
    await setQty(a.id, 'proto_empereur', 1);
    await setQty(b.id, 'proto_garde', 2);
    const gift = (await propose(a, b.id, [['proto_empereur', 1]], [])).json().trade;
    expect((await post(`/api/trades/${gift.id}/accept`, b.token)).statusCode).toBe(200);
    expect(await qty(b.id, 'proto_empereur')).toBe(1);
    expect(await qty(a.id, 'proto_empereur')).toBe(0);

    const ask = (await propose(a, b.id, [], [['proto_garde', 2]])).json().trade;
    expect((await post(`/api/trades/${ask.id}/accept`, b.token)).statusCode).toBe(200);
    expect(await qty(a.id, 'proto_garde')).toBe(2);
    expect(await qty(b.id, 'proto_garde')).toBe(0);
  });

  it('pas de limite par jour, GOAT comprises ; comptes liés autorisés', async () => {
    const [a, b] = await friends();
    await setQty(a.id, 'proto_empereur', 10);
    // Même appareil : signalé pour revue, mais l'échange reste possible.
    await t.db.query("INSERT INTO account_flags (user_id, other_user_id, reason) VALUES ($1, $2, 'shared_device')", [a.id, b.id]);
    for (let i = 0; i < 8; i++) {
      const id = (await propose(a, b.id, [['proto_empereur', 1]], [])).json().trade.id;
      expect((await post(`/api/trades/${id}/accept`, b.token)).statusCode).toBe(200);
    }
    expect(await qty(b.id, 'proto_empereur')).toBe(8);
  });

  it('refus : échange vide, même carte des deux côtés, carte non possédée, pas amis, carte inconnue', async () => {
    const [a, b] = await friends();
    await setQty(a.id, 'proto_chevalier', 1);
    await setQty(b.id, 'proto_garde', 1);
    expect((await propose(a, b.id, [], [])).json().error).toBe('empty_trade');
    expect((await propose(a, b.id, [['proto_chevalier', 1]], [['proto_chevalier', 1]])).json().error).toBe('same_card');
    expect((await propose(a, b.id, [['proto_chevalier', 2]], [])).json().error).toBe('not_owned');
    expect((await propose(a, b.id, [], [['proto_garde', 2]])).json().error).toBe('not_owned_by_friend');
    expect((await propose(a, b.id, [['proto_inconnue', 1]], [])).statusCode).toBe(404);
    const stranger = await signup(t.app);
    expect((await propose(a, stranger.id, [['proto_chevalier', 1]], [])).json().error).toBe('not_friends');
  });

  it('refus et annulation ; proposition expirée ; carte partie entre-temps ; retirer un ami annule les propositions', async () => {
    const [a, b] = await friends();
    await setQty(a.id, 'proto_chevalier', 3);
    await setQty(b.id, 'proto_garde', 3);
    const next = async () => (await propose(a, b.id, [['proto_chevalier', 1]], [['proto_garde', 1]])).json().trade.id as string;

    const t1 = await next();
    expect((await post(`/api/trades/${t1}/cancel`, b.token)).json().error).toBe('not_your_trade');
    expect((await post(`/api/trades/${t1}/decline`, b.token)).statusCode).toBe(200);
    const t2 = await next();
    expect((await post(`/api/trades/${t2}/cancel`, a.token)).statusCode).toBe(200);

    const t3 = await next();
    await t.db.query("UPDATE trades SET expires_at = now() - interval '1 minute' WHERE id = $1", [t3]);
    expect((await post(`/api/trades/${t3}/accept`, b.token)).statusCode).toBe(410);
    expect((await get('/api/trades', a.token)).json().history.find((x: { id: string }) => x.id === t3).status).toBe('expired');

    const t4 = await next();
    await setQty(a.id, 'proto_chevalier', 0);
    expect((await post(`/api/trades/${t4}/accept`, b.token)).json().error).toBe('not_owned');
    expect(await qty(b.id, 'proto_garde')).toBe(3);

    await setQty(a.id, 'proto_chevalier', 1);
    const t5 = await next();
    expect((await del(`/api/friends/${b.id}`, a.token)).statusCode).toBe(200);
    expect((await get('/api/trades', a.token)).json().history.find((x: { id: string }) => x.id === t5).status).toBe('cancelled');
  });

  it('une carte donnée quitte les decks de son ancien propriétaire', async () => {
    const [a, b] = await friends();
    await setQty(a.id, 'proto_l_star', 1);
    await setQty(a.id, 'proto_chevalier', 2);
    await setQty(a.id, 'proto_garde', 2);
    await t.db.query('INSERT INTO decks (user_id, name, leader_id, card_ids) VALUES ($1, $2, $3, $4)', [
      a.id,
      'Test',
      'proto_l_star',
      ['proto_chevalier', 'proto_chevalier', 'proto_garde', 'proto_garde'],
    ]);
    const id = (await propose(a, b.id, [['proto_chevalier', 1]], [])).json().trade.id;
    expect((await post(`/api/trades/${id}/accept`, b.token)).statusCode).toBe(200);
    const [deck] = await t.db.query<{ card_ids: string[] }>('SELECT card_ids FROM decks WHERE user_id = $1', [a.id]);
    expect(deck!.card_ids).toEqual(['proto_chevalier', 'proto_garde', 'proto_garde']);
  });
});
