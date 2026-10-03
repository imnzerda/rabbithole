import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { DEFAULT_ECONOMY } from '../src/config.js';
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
/** En test, tous les comptes viennent de la même adresse, donc sont « liés » : on efface ce signalement. */
const unlink = (a: string, b: string) =>
  t.db.query('DELETE FROM account_flags WHERE (user_id = $1 AND other_user_id = $2) OR (user_id = $2 AND other_user_id = $1)', [a, b]);

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
  await unlink(a.id, b.id);
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
  it('1 contre 1, même rareté : proposé, accepté, les cartes changent de main', async () => {
    const [a, b] = await friends();
    await setQty(a.id, 'proto_chevalier', 1);
    await setQty(b.id, 'proto_garde', 2);
    const proposed = await post('/api/trades', a.token, { toUserId: b.id, offeredCardId: 'proto_chevalier', requestedCardId: 'proto_garde' });
    expect(proposed.statusCode).toBe(200);
    const trade = proposed.json().trade;
    expect(trade).toMatchObject({ status: 'pending', rarity: 'basique', fromUser: { id: a.id }, toUser: { id: b.id } });
    // Rien ne bouge avant l'acceptation.
    expect(await qty(a.id, 'proto_chevalier')).toBe(1);
    expect((await get('/api/trades', b.token)).json().incoming.map((x: { id: string }) => x.id)).toEqual([trade.id]);
    expect((await get('/api/trades', a.token)).json().outgoing.map((x: { id: string }) => x.id)).toEqual([trade.id]);

    // Seul le destinataire accepte.
    expect((await post(`/api/trades/${trade.id}/accept`, a.token)).json().error).toBe('not_your_trade');
    const done = await post(`/api/trades/${trade.id}/accept`, b.token);
    expect(done.json().trade.status).toBe('accepted');
    expect(await qty(a.id, 'proto_chevalier')).toBe(0);
    expect(await qty(a.id, 'proto_garde')).toBe(1);
    expect(await qty(b.id, 'proto_garde')).toBe(1);
    expect(await qty(b.id, 'proto_chevalier')).toBe(1);
    expect((await post(`/api/trades/${trade.id}/accept`, b.token)).json().error).toBe('trade_closed');
    expect((await get('/api/trades', a.token)).json().history[0]).toMatchObject({ id: trade.id, status: 'accepted' });
    // Aucune monnaie en jeu.
    expect((await get('/api/wallet', a.token)).json().wallet).toMatchObject({ coins: 0, gems: 0, essence: 0 });
  });

  it('refus : raretés différentes, carte non possédée, même carte, pas amis, comptes liés', async () => {
    const [a, b] = await friends();
    await setQty(a.id, 'proto_chevalier', 1);
    await setQty(b.id, 'proto_buteur', 1);
    await setQty(b.id, 'proto_garde', 1);
    const propose = (from: { token: string }, to: string, offered: string, requested: string) =>
      post('/api/trades', from.token, { toUserId: to, offeredCardId: offered, requestedCardId: requested });
    expect((await propose(a, b.id, 'proto_chevalier', 'proto_buteur')).json().error).toBe('rarity_mismatch');
    expect((await propose(a, b.id, 'proto_sprinteur', 'proto_garde')).json().error).toBe('not_owned');
    expect((await propose(a, b.id, 'proto_chevalier', 'proto_ultra')).json().error).toBe('not_owned_by_friend');
    expect((await propose(a, b.id, 'proto_chevalier', 'proto_chevalier')).json().error).toBe('same_card');
    expect((await propose(a, b.id, 'proto_chevalier', 'proto_inconnue')).statusCode).toBe(404);

    const stranger = await signup(t.app);
    await setQty(stranger.id, 'proto_garde', 1);
    expect((await propose(a, stranger.id, 'proto_chevalier', 'proto_garde')).json().error).toBe('not_friends');

    // Même appareil ou même réseau : interdits d'échange entre eux (section 6.5).
    await t.db.query("INSERT INTO account_flags (user_id, other_user_id, reason) VALUES ($1, $2, 'shared_device')", [a.id, b.id]);
    expect((await propose(a, b.id, 'proto_chevalier', 'proto_garde')).json().error).toBe('linked_accounts');
  });

  it('refus et annulation ; proposition expirée ; carte partie entre-temps', async () => {
    const [a, b] = await friends();
    await setQty(a.id, 'proto_chevalier', 3);
    await setQty(b.id, 'proto_garde', 3);
    const propose = async () =>
      (await post('/api/trades', a.token, { toUserId: b.id, offeredCardId: 'proto_chevalier', requestedCardId: 'proto_garde' })).json().trade.id as string;

    const t1 = await propose();
    expect((await post(`/api/trades/${t1}/cancel`, b.token)).json().error).toBe('not_your_trade');
    expect((await post(`/api/trades/${t1}/decline`, b.token)).statusCode).toBe(200);
    const t2 = await propose();
    expect((await post(`/api/trades/${t2}/cancel`, a.token)).statusCode).toBe(200);

    const t3 = await propose();
    await t.db.query("UPDATE trades SET expires_at = now() - interval '1 minute' WHERE id = $1", [t3]);
    expect((await post(`/api/trades/${t3}/accept`, b.token)).statusCode).toBe(410);
    expect((await get('/api/trades', a.token)).json().history.find((x: { id: string }) => x.id === t3).status).toBe('expired');

    const t4 = await propose();
    await setQty(a.id, 'proto_chevalier', 0);
    expect((await post(`/api/trades/${t4}/accept`, b.token)).json().error).toBe('not_owned_by_friend');
    expect(await qty(b.id, 'proto_garde')).toBe(3);
  });

  it('limite : 5 échanges par jour ; retirer un ami annule les propositions en attente', async () => {
    const [a, b] = await friends();
    await setQty(a.id, 'proto_chevalier', 20);
    await setQty(b.id, 'proto_garde', 20);
    for (let i = 0; i < DEFAULT_ECONOMY.trades.perDay; i++) {
      const id = (await post('/api/trades', a.token, { toUserId: b.id, offeredCardId: 'proto_chevalier', requestedCardId: 'proto_garde' })).json().trade.id;
      expect((await post(`/api/trades/${id}/accept`, b.token)).statusCode).toBe(200);
    }
    const over = await post('/api/trades', a.token, { toUserId: b.id, offeredCardId: 'proto_chevalier', requestedCardId: 'proto_garde' });
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toBe('daily_limit');

    // Les échanges d'hier ne comptent plus.
    await t.db.query("UPDATE trades SET resolved_at = now() - interval '2 days' WHERE from_user = $1", [a.id]);
    const pending = (await post('/api/trades', a.token, { toUserId: b.id, offeredCardId: 'proto_chevalier', requestedCardId: 'proto_garde' })).json().trade.id;
    expect((await del(`/api/friends/${b.id}`, a.token)).statusCode).toBe(200);
    expect((await get('/api/trades', a.token)).json().history.find((x: { id: string }) => x.id === pending).status).toBe('cancelled');
  });

  it('GOAT : 1 échange par semaine', async () => {
    const [a, b] = await friends();
    // Le prototype n'a qu'une GOAT : une deuxième, le temps du test.
    await t.db.query("UPDATE cards SET def = jsonb_set(def, '{rarity}', '\"goat\"') WHERE id = 'proto_parrain'");
    await t.catalog.reload();
    try {
      await setQty(a.id, 'proto_empereur', 2);
      await setQty(b.id, 'proto_parrain', 2);
      const first = (await post('/api/trades', a.token, { toUserId: b.id, offeredCardId: 'proto_empereur', requestedCardId: 'proto_parrain' })).json().trade;
      expect(first.rarity).toBe('goat');
      expect((await post(`/api/trades/${first.id}/accept`, b.token)).statusCode).toBe(200);
      const second = await post('/api/trades', a.token, { toUserId: b.id, offeredCardId: 'proto_empereur', requestedCardId: 'proto_parrain' });
      expect(second.json().error).toBe('goat_weekly_limit');
    } finally {
      await t.db.query("UPDATE cards SET def = jsonb_set(def, '{rarity}', '\"iconique\"') WHERE id = 'proto_parrain'");
      await t.catalog.reload();
    }
  });
});
