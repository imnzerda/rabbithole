import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ECONOMY } from '../src/config.js';
import { auth, signup, signupPayload, startApp } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
afterEach(async () => {
  if (t) await t.app.close();
  t = null;
});

const ADMIN = 'retraits@example.com';

async function setup() {
  t = await startApp({ adminEmails: [ADMIN] });
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload('retraits', { email: ADMIN }) });
  const token = res.cookies.find((c) => c.name === 'rh_session')!.value;
  const admin = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => t!.app.inject({ method, url, headers: auth(token), payload: payload as object });
  return { admin };
}

const get = (url: string, token: string) => t!.app.inject({ method: 'GET', url, headers: auth(token) });
const post = (url: string, token: string, payload?: unknown) => t!.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as object });
const setQty = (id: string, cardId: string, quantity: number) =>
  t!.db.query(
    `INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    [id, cardId, quantity],
  );
const coins = async (token: string) => (await get('/api/wallet', token)).json().wallet.coins as number;
const owned = async (token: string) => new Map<string, number>((await get('/api/collection', token)).json().cards.map((c: { cardId: string; quantity: number }) => [c.cardId, c.quantity]));

describe('carte retirée du jeu : compensation', () => {
  it('« Supprimer » une carte publiée : pièces au prix de fabrication par exemplaire, collections, decks, échanges, notification', async () => {
    const { admin } = await setup();
    const a = await signup(t!.app);
    const b = await signup(t!.app);
    await setQty(a.id, 'proto_chevalier', 3);
    await setQty(a.id, 'proto_garde', 2);
    await setQty(a.id, 'proto_l_star', 1);
    await setQty(b.id, 'proto_chevalier', 1);
    await t!.db.query('INSERT INTO decks (user_id, name, leader_id, card_ids) VALUES ($1, $2, $3, $4)', [
      a.id,
      'Deck',
      'proto_l_star',
      ['proto_chevalier', 'proto_chevalier', 'proto_garde', 'proto_garde'],
    ]);
    // Une proposition d'échange en attente contient la carte.
    const code = (await get('/api/friends', b.token)).json().code;
    await post('/api/friends', a.token, { code });
    await post(`/api/friends/${a.id}/accept`, b.token);
    const trade = (await post('/api/trades', a.token, { toUserId: b.id, offered: [{ cardId: 'proto_chevalier', quantity: 1 }], requested: [] })).json().trade;

    const res = await admin('DELETE', '/api/admin/cards/proto_chevalier');
    expect(res.json().result).toBe('retired');
    const per = DEFAULT_ECONOMY.craft.basique;
    expect(await coins(a.token)).toBe(3 * per);
    expect(await coins(b.token)).toBe(per);
    expect((await owned(a.token)).has('proto_chevalier')).toBe(false);
    expect(t!.catalog.current.ctx.cards.proto_chevalier).toBeUndefined();
    const [deck] = await t!.db.query<{ card_ids: string[] }>('SELECT card_ids FROM decks WHERE user_id = $1', [a.id]);
    expect(deck!.card_ids).toEqual(['proto_garde', 'proto_garde']);
    expect((await get('/api/trades', a.token)).json().history.find((x: { id: string }) => x.id === trade.id).status).toBe('cancelled');

    const notices = (await get('/api/notices', a.token)).json().notices;
    expect(notices).toEqual([
      expect.objectContaining({ kind: 'card_retired', read: false, payload: expect.objectContaining({ cardId: 'proto_chevalier', quantity: 3, coins: 3 * per, rarity: 'basique' }) }),
    ]);
    expect((await post('/api/notices/read', a.token, { id: notices[0].id })).statusCode).toBe(200);
    expect((await get('/api/notices', a.token)).json().notices[0].read).toBe(true);
    const [ledger] = await t!.db.query<{ amount: number }>("SELECT amount FROM coin_ledger WHERE user_id = $1 AND reason = 'card_retired'", [a.id]);
    expect(ledger!.amount).toBe(3 * per);
  });

  it('statut « retirée » dans l’admin et demande de retrait acceptée : même compensation', async () => {
    const { admin } = await setup();
    const p = await signup(t!.app);
    await setQty(p.id, 'proto_buteur', 2);
    await setQty(p.id, 'proto_empereur', 1);

    expect((await admin('POST', '/api/admin/cards/proto_buteur/status', { status: 'retired' })).statusCode).toBe(200);
    expect(await coins(p.token)).toBe(2 * DEFAULT_ECONOMY.craft.tendance);

    const takedown = await t!.app.inject({
      method: 'POST',
      url: '/api/takedown',
      payload: { cardId: 'proto_empereur', name: 'Ayant droit', contact: 'ayant.droit@example.com', relation: 'self', reason: 'Je souhaite le retrait de cette carte.' },
    });
    expect(takedown.statusCode).toBeLessThan(300);
    expect((await admin('POST', `/api/admin/takedowns/${takedown.json().id}`, { status: 'done', retireCard: true })).statusCode).toBe(200);
    expect(await coins(p.token)).toBe(2 * DEFAULT_ECONOMY.craft.tendance + DEFAULT_ECONOMY.craft.goat);
    expect((await get('/api/notices', p.token)).json().notices).toHaveLength(2);
    // Tout marquer comme lu.
    await post('/api/notices/read', p.token, {});
    expect((await get('/api/notices', p.token)).json().notices.every((n: { read: boolean }) => n.read)).toBe(true);
  });
});
