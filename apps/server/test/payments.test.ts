import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { loadConfig, testConfig } from '../src/config.js';
import { SandboxProvider, type PaymentEvent } from '../src/payments/provider.js';
import { auth, signupPayload, startApp } from './helpers.js';

let t: App & { url: string };
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.app.close();
});

const get = (url: string, token: string) => t.app.inject({ method: 'GET', url, headers: auth(token) });
const post = (url: string, token: string, payload?: unknown) => t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as object });
let n = 0;
async function player(country = 'FR'): Promise<{ token: string; id: string }> {
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload(`acheteur${++n}`, { country }) });
  expect(res.statusCode).toBe(201);
  return { token: res.cookies.find((c) => c.name === 'rh_session')!.value, id: res.json().user.id };
}
const gems = async (token: string) => (await get('/api/wallet', token)).json().wallet.gems as number;
const sessionOf = (url: string) => new URL(url, 'http://x').searchParams.get('session')!;

/** Webhook signé comme le ferait le prestataire sandbox. */
const signer = new SandboxProvider(testConfig().payments.sandboxSecret, async () => {});
const webhook = (event: PaymentEvent, signature = signer.sign(JSON.stringify(event))) =>
  t.app.inject({
    method: 'POST',
    url: '/api/webhooks/payment/sandbox',
    payload: JSON.stringify(event),
    headers: { 'content-type': 'application/json', 'x-sandbox-signature': signature },
  });

describe('boutique', () => {
  it('6 packs de gemmes, au prix du pays (sinon en euros)', async () => {
    const fr = (await get('/api/shop', (await player('FR')).token)).json();
    expect(fr.enabled).toBe(true);
    expect(fr.offers).toHaveLength(6);
    expect(fr.offers[0]).toMatchObject({ id: 'gems_80', gems: 80, amount: 99, currency: 'EUR' });
    const jp = (await get('/api/shop', (await player('JP')).token)).json();
    expect(jp.offers[0]).toMatchObject({ amount: 160, currency: 'JPY' });
  });

  it('paiement : rien n’est crédité au passage en caisse ; le webhook du prestataire crédite, une seule fois', async () => {
    const p = await player();
    const { url, transactionId } = (await post('/api/shop/checkout', p.token, { productId: 'gems_450' })).json();
    expect(url).toMatch(/^\/shop\/sandbox\?session=sbx_/);
    expect(await gems(p.token)).toBe(0);
    expect((await get('/api/purchases', p.token)).json().purchases[0]).toMatchObject({ id: transactionId, status: 'pending', gems: 450 });

    const session = sessionOf(url);
    expect((await get(`/api/payments/sandbox/${session}`, p.token)).json().session).toMatchObject({ amount: 499, currency: 'EUR', status: 'pending' });
    expect((await post(`/api/payments/sandbox/${session}/pay`, p.token)).statusCode).toBe(200);
    expect(await gems(p.token)).toBe(450);
    expect((await get('/api/purchases', p.token)).json().purchases[0].status).toBe('completed');
    // Payer deux fois la même session : refusé.
    expect((await post(`/api/payments/sandbox/${session}/pay`, p.token)).statusCode).toBe(409);
    expect(await gems(p.token)).toBe(450);
  });

  it('webhooks : signature vérifiée, événement rejoué sans effet, montant incohérent jamais crédité', async () => {
    const p = await player();
    const { url } = (await post('/api/shop/checkout', p.token, { productId: 'gems_80' })).json();
    const event: PaymentEvent = { id: 'evt_test_1', type: 'payment_succeeded', sessionId: sessionOf(url), providerTransactionId: 'tx_test_1', amount: 99, currency: 'EUR' };
    expect((await webhook(event, 'f'.repeat(64))).statusCode).toBe(401);
    expect((await webhook(event, 'pas-une-signature')).statusCode).toBe(401);
    expect(await gems(p.token)).toBe(0);

    expect((await webhook(event)).json().result).toBe('applied');
    expect((await webhook(event)).json().result).toBe('duplicate');
    expect((await webhook({ ...event, id: 'evt_test_2' })).json().result).toBe('ignored');
    expect(await gems(p.token)).toBe(80);

    const other = (await post('/api/shop/checkout', p.token, { productId: 'gems_80' })).json();
    const wrong = await webhook({ ...event, id: 'evt_test_3', sessionId: sessionOf(other.url), providerTransactionId: 'tx_test_3', amount: 1 });
    expect(wrong.json().result).toBe('ignored');
    expect(await gems(p.token)).toBe(80);
    expect((await get('/api/purchases', p.token)).json().purchases[0].status).toBe('mismatch');
  });

  it('remboursement et rétrofacturation : gemmes retirées, rétrofacturation signalée', async () => {
    const p = await player();
    for (const id of ['evt_r1', 'evt_r2']) {
      const { url } = (await post('/api/shop/checkout', p.token, { productId: 'gems_170' })).json();
      await webhook({ id, type: 'payment_succeeded', sessionId: sessionOf(url), providerTransactionId: `tx_${id}`, amount: 199, currency: 'EUR' });
    }
    expect(await gems(p.token)).toBe(340);
    expect((await webhook({ id: 'evt_r3', type: 'refunded', providerTransactionId: 'tx_evt_r1' })).json().result).toBe('applied');
    expect((await webhook({ id: 'evt_r3', type: 'refunded', providerTransactionId: 'tx_evt_r1' })).json().result).toBe('duplicate');
    expect(await gems(p.token)).toBe(170);
    await webhook({ id: 'evt_r4', type: 'chargeback', providerTransactionId: 'tx_evt_r2' });
    expect(await gems(p.token)).toBe(0);
    const statuses = (await get('/api/purchases', p.token)).json().purchases.map((x: { status: string }) => x.status).sort();
    expect(statuses).toEqual(['chargeback', 'refunded']);
    // Gemmes déjà dépensées : le remboursement rend le solde négatif au lieu d'échouer.
    const { url } = (await post('/api/shop/checkout', p.token, { productId: 'gems_80' })).json();
    await webhook({ id: 'evt_r5', type: 'payment_succeeded', sessionId: sessionOf(url), providerTransactionId: 'tx_evt_r5', amount: 99, currency: 'EUR' });
    await t.db.query('UPDATE wallets SET gems = 0 WHERE user_id = $1', [p.id]);
    expect((await webhook({ id: 'evt_r6', type: 'refunded', providerTransactionId: 'tx_evt_r5' })).json().result).toBe('applied');
    expect(await gems(p.token)).toBe(-80);
    const [audit] = await t.db.query("SELECT 1 FROM admin_audit WHERE action = 'payment.chargeback' AND target = $1", [p.id]);
    expect(audit).toBeTruthy();
  });

  it('plafond mensuel facultatif ; paiement abandonné : rien n’est dû', async () => {
    const p = await player();
    expect((await post('/api/me/spend-cap', p.token, { cap: 300 })).json().spendCap).toBe(300);
    const first = (await post('/api/shop/checkout', p.token, { productId: 'gems_170' })).json();
    const over = await post('/api/shop/checkout', p.token, { productId: 'gems_170' });
    expect(over.statusCode).toBe(403);
    expect(over.json().error).toBe('spend_cap_reached');
    // Abandon de la page de paiement : la somme en attente ne compte plus.
    expect((await post(`/api/payments/sandbox/${sessionOf(first.url)}/cancel`, p.token)).statusCode).toBe(200);
    expect((await post('/api/shop/checkout', p.token, { productId: 'gems_170' })).statusCode).toBe(200);
    await post('/api/me/spend-cap', p.token, { cap: null });
    expect((await get('/api/shop', p.token)).json().spendCap).toBeNull();
    expect((await post('/api/shop/checkout', p.token, { productId: 'inconnu' })).statusCode).toBe(404);
  });

  it('aucun crédit côté client ; sandbox interdit en production', async () => {
    const p = await player();
    for (const url of ['/api/wallet/gems', '/api/shop/credit', '/api/purchases/complete']) expect((await post(url, p.token, { gems: 1000 })).statusCode, url).toBe(404);
    const prod = { NODE_ENV: 'production', SIGNAL_SALT: 's', TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET: 's', SMS_MODE: 'off' };
    expect(() => loadConfig({ ...prod, PAYMENT_PROVIDER: 'sandbox' })).toThrow(/interdit en production/);
    expect(loadConfig(prod).payments.provider).toBe('none');
  });

  it('sans prestataire : boutique fermée, aucun webhook accepté', async () => {
    const closed = await startApp({ payments: { provider: 'none', sandboxSecret: 'x' } });
    try {
      const res = await closed.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload('fermee') });
      const token = res.cookies.find((c) => c.name === 'rh_session')!.value;
      expect((await closed.app.inject({ method: 'GET', url: '/api/shop', headers: auth(token) })).json().enabled).toBe(false);
      const checkout = await closed.app.inject({ method: 'POST', url: '/api/shop/checkout', headers: auth(token), payload: { productId: 'gems_80' } });
      expect(checkout.statusCode).toBe(503);
      const hook = await closed.app.inject({ method: 'POST', url: '/api/webhooks/payment/sandbox', payload: '{}', headers: { 'content-type': 'application/json' } });
      expect(hook.statusCode).toBe(404);
    } finally {
      await closed.app.close();
    }
  });
});
