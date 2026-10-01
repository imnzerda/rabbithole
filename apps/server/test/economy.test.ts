import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { DEFAULT_ECONOMY } from '../src/config.js';
import { boosterOdds, generateBooster } from '../src/economy/economy.js';
import { auth, signup, startApp } from './helpers.js';

let t: App & { url: string };
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.app.close();
});

const get = (url: string, token: string) => t.app.inject({ method: 'GET', url, headers: auth(token) });
const post = (url: string, token: string, payload?: unknown) => t.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as object });
const giveCoins = (id: string, coins: number) => t.db.query('UPDATE wallets SET coins = $2 WHERE user_id = $1', [id, coins]);
const owned = async (token: string) =>
  new Map<string, number>((await get('/api/collection', token)).json().cards.map((c: { cardId: string; quantity: number }) => [c.cardId, c.quantity]));

describe('génération des boosters', () => {
  it('déterministe pour une seed, conforme aux probabilités affichées', () => {
    expect(generateBooster('base', 'seed-1', DEFAULT_ECONOMY, t.catalog.current)).toEqual(generateBooster('base', 'seed-1', DEFAULT_ECONOMY, t.catalog.current));
    const odds = boosterOdds('base', DEFAULT_ECONOMY, t.catalog.current);
    expect(Object.values(odds).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
    const counts: Record<string, number> = {};
    const n = 3000;
    for (let i = 0; i < n; i++) {
      for (const id of generateBooster('base', `s${i}`, DEFAULT_ECONOMY, t.catalog.current)) {
        const r = t.catalog.current.ctx.cards[id]!.rarity;
        counts[r] = (counts[r] ?? 0) + 1;
      }
    }
    for (const [rarity, pct] of Object.entries(odds)) {
      const observed = ((counts[rarity] ?? 0) / (n * DEFAULT_ECONOMY.boosterSize)) * 100;
      expect(Math.abs(observed - pct), rarity).toBeLessThan(1.5);
    }
  });
});

describe('boosters', () => {
  it('boosters gratuits de bienvenue : contenu aléatoire, ajouté à la collection, jusqu’à épuisement', async () => {
    const { token } = await signup(t.app);
    const first = await post('/api/boosters/base/open-free', token);
    expect(first.statusCode).toBe(200);
    expect(first.json().cards).toHaveLength(5);
    expect(first.json().wallet.freeBoosters).toBe(5);
    const collection = await owned(token);
    expect([...collection.values()].reduce((a, b) => a + b, 0)).toBe(5);
    for (let i = 0; i < 5; i++) await post('/api/boosters/base/open-free', token);
    const none = await post('/api/boosters/base/open-free', token);
    expect(none.statusCode).toBe(402);
    expect(none.json().error).toBe('no_free_booster');
  });

  it('aperçu stable ; achat = exactement l’aperçu ; nouvel aperçu immédiatement après', async () => {
    const { token, id } = await signup(t.app);
    const shop = (await get('/api/boosters', token)).json();
    const preview = shop.types[0].preview.cardIds as string[];
    expect(preview).toHaveLength(5);
    expect(shop.types[0].odds).toEqual(boosterOdds('base', DEFAULT_ECONOMY, t.catalog.current));
    expect((await get('/api/boosters', token)).json().types[0].preview.cardIds).toEqual(preview);

    const broke = await post('/api/boosters/base/purchase', token, { cardIds: preview });
    expect(broke.statusCode).toBe(402);
    expect(broke.json().error).toBe('not_enough_coins');

    await giveCoins(id, 250);
    const bought = await post('/api/boosters/base/purchase', token, { cardIds: preview });
    expect(bought.statusCode).toBe(200);
    expect(bought.json().cards).toEqual(preview);
    expect(bought.json().wallet.coins).toBe(150);
    const collection = await owned(token);
    for (const cardId of new Set(preview)) expect(collection.get(cardId)).toBe(preview.filter((x) => x === cardId).length);

    const next = (await get('/api/boosters', token)).json().types[0].preview;
    expect(next.cardIds).toEqual(bought.json().preview.cardIds);
    const audit = await t.db.query<{ seed: string; card_ids: string[] }>("SELECT seed, card_ids FROM booster_openings WHERE user_id = $1 AND source = 'purchase'", [id]);
    expect(generateBooster('base', audit[0]!.seed, DEFAULT_ECONOMY, t.catalog.current)).toEqual(audit[0]!.card_ids);
  });

  it('jamais de contenu non montré : achat refusé si l’aperçu a changé', async () => {
    const { token, id } = await signup(t.app);
    await giveCoins(id, 500);
    const preview = (await get('/api/boosters', token)).json().types[0].preview.cardIds as string[];
    // L'aperçu expire (24 h) : un nouveau est généré, l'ancien ne peut plus être acheté.
    await t.db.query("UPDATE booster_previews SET refresh_at = now() - interval '1 minute' WHERE user_id = $1", [id]);
    const res = await post('/api/boosters/base/purchase', token, { cardIds: preview });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('preview_changed');
    expect((await get('/api/wallet', token)).json().wallet.coins).toBe(500);
  });

  it('aucun moyen de renouveler un aperçu contre une monnaie', async () => {
    const { token } = await signup(t.app);
    for (const url of ['/api/boosters/base/refresh', '/api/boosters/base/reroll', '/api/boosters/refresh']) {
      expect((await post(url, token)).statusCode, url).toBe(404);
    }
  });
});

describe('collection', () => {
  it('Leader de départ : une seule fois, un vrai Leader', async () => {
    const { token } = await signup(t.app);
    expect((await post('/api/starter-leader', token, { leaderId: 'proto_streamer' })).statusCode).toBe(400);
    expect((await post('/api/starter-leader', token, { leaderId: 'proto_l_professeur' })).statusCode).toBe(200);
    expect((await owned(token)).get('proto_l_professeur')).toBe(1);
    expect((await get('/api/me', token)).json().user.starterLeader).toBe('proto_l_professeur');
    expect((await post('/api/starter-leader', token, { leaderId: 'proto_l_star' })).statusCode).toBe(409);
  });

  it('recyclage des doublons au-delà de 2, puis fabrication avec l’essence', async () => {
    const { token, id } = await signup(t.app);
    await t.db.query("INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, 'proto_chevalier', 6)", [id]);
    const tooMany = await post('/api/collection/recycle', token, { cardId: 'proto_chevalier', count: 5 });
    expect(tooMany.json().error).toBe('not_enough_duplicates');
    const ok = await post('/api/collection/recycle', token, { cardId: 'proto_chevalier', count: 4 });
    expect(ok.json().wallet.essence).toBe(4 * DEFAULT_ECONOMY.recycle.basique);
    expect((await owned(token)).get('proto_chevalier')).toBe(2);

    expect((await post('/api/collection/craft', token, { cardId: 'proto_chevalier' })).json().error).toBe('already_complete');
    expect((await post('/api/collection/craft', token, { cardId: 'proto_empereur' })).json().error).toBe('not_enough_essence');
    const crafted = await post('/api/collection/craft', token, { cardId: 'proto_figurant' });
    expect(crafted.statusCode).toBe(200);
    expect(crafted.json().wallet.essence).toBe(4 * DEFAULT_ECONOMY.recycle.basique - DEFAULT_ECONOMY.craft.basique);
    expect((await owned(token)).get('proto_figurant')).toBe(1);
    expect((await post('/api/collection/craft', token, { cardId: 'proto_ovni' })).statusCode).toBe(404);
  });
});
