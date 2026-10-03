import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PASS, testConfig } from '../src/config.js';
import { SandboxProvider } from '../src/payments/provider.js';
import { addPassXp, currentSeason, generateRewards } from '../src/retention/pass.js';
import { auth, signup, signupWithKit, startApp, TestClient } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (t) await t.app.close();
  t = null;
});

const get = (url: string, token: string) => t!.app.inject({ method: 'GET', url, headers: auth(token) });
const post = (url: string, token: string, payload?: unknown) => t!.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as object });
const sessionOf = (url: string) => new URL(url, 'http://x').searchParams.get('session')!;
const pass = async (token: string) => (await get('/api/pass', token)).json().pass;

/** Achat d'une piste par la page de paiement factice (webhook signé du prestataire sandbox). */
async function buy(token: string, productId: string): Promise<void> {
  const res = await post('/api/shop/checkout', token, { productId, returnPath: '/pass' });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().url).toContain('next=%2Fpass');
  expect((await post(`/api/payments/sandbox/${sessionOf(res.json().url)}/pay`, token)).statusCode).toBe(200);
}

describe('pass saisonnier', () => {
  it('saisons de 28 jours depuis l’epoch', () => {
    expect(currentSeason(DEFAULT_PASS, new Date('2026-10-03T12:00:00Z'))).toEqual({
      season: 1,
      startsAt: new Date('2026-10-01T00:00:00Z'),
      endsAt: new Date('2026-10-29T00:00:00Z'),
    });
    expect(currentSeason(DEFAULT_PASS, new Date('2026-10-29T00:00:00Z')).season).toBe(2);
  });

  it('récompenses : pistes payantes = cosmétiques et boosters à aperçu uniquement (jamais de pièces ni de booster aléatoire)', async () => {
    t = await startApp();
    const tiers = generateRewards(1, DEFAULT_PASS, t.catalog.current);
    expect(tiers).toHaveLength(DEFAULT_PASS.tiers);
    expect(generateRewards(1, DEFAULT_PASS, t.catalog.current)).toEqual(tiers);
    for (const tier of tiers) {
      expect(['coins', 'free_booster']).toContain(tier.free!.type);
      for (const paid of [tier.premium, tier.deluxe]) if (paid) expect(['title', 'variant', 'preview_booster']).toContain(paid.type);
    }
    expect(tiers.some((x) => x.premium?.type === 'variant')).toBe(true);
    expect(tiers.some((x) => x.deluxe?.type === 'variant')).toBe(true);
  });

  it('niveaux par points ; piste gratuite réclamable ; verrous (niveau, piste, double réclamation)', async () => {
    t = await startApp();
    const { token, id } = await signup(t.app);
    const start = (await get('/api/pass', token)).json();
    expect(start.pass).toMatchObject({ season: currentSeason(DEFAULT_PASS).season, xp: 0, level: 0, track: 'free' });
    expect(start.offers.map((o: { id: string; amount: number }) => [o.id, o.amount])).toEqual([
      ['pass_premium', 999],
      ['pass_deluxe', 1499],
      ['pass_upgrade', 500],
    ]);

    await addPassXp(t.db, id, 2 * DEFAULT_PASS.xpPerTier + 500, DEFAULT_PASS);
    expect((await pass(token)).level).toBe(2);
    const claimed = await post('/api/pass/claim', token, { tier: 1, track: 'free' });
    expect(claimed.json().reward).toEqual({ type: 'coins', amount: DEFAULT_PASS.freeCoins });
    expect(claimed.json().wallet.coins).toBe(DEFAULT_PASS.freeCoins);
    expect((await post('/api/pass/claim', token, { tier: 1, track: 'free' })).json().error).toBe('already_claimed');
    expect((await post('/api/pass/claim', token, { tier: 3, track: 'free' })).json().error).toBe('tier_locked');
    expect((await post('/api/pass/claim', token, { tier: 1, track: 'premium' })).json().error).toBe('track_locked');
    expect((await pass(token)).claimed.free).toEqual([1]);
  });

  it('achat direct : premium, puis passage au deluxe ; cosmétiques ; booster à aperçu offert = l’aperçu exact', async () => {
    t = await startApp();
    const { token, id } = await signup(t.app);
    await addPassXp(t.db, id, 3 * DEFAULT_PASS.xpPerTier, DEFAULT_PASS);
    expect((await post('/api/shop/checkout', token, { productId: 'pass_upgrade' })).json().error).toBe('pass_not_available');
    await buy(token, 'pass_premium');
    expect((await pass(token)).track).toBe('premium');
    expect((await post('/api/shop/checkout', token, { productId: 'pass_premium' })).json().error).toBe('pass_not_available');
    // Le pass ne passe pas par les gemmes.
    expect((await get('/api/wallet', token)).json().wallet.gems).toBe(0);

    // Titre de la piste premium, puis titre actif.
    const title = (await post('/api/pass/claim', token, { tier: 1, track: 'premium' })).json().reward;
    expect(title.type).toBe('title');
    expect((await post('/api/cosmetics/title', token, { titleId: title.id })).statusCode).toBe(200);
    expect((await post('/api/cosmetics/title', token, { titleId: 'pas_a_moi' })).statusCode).toBe(403);

    // Booster à aperçu offert (niveau 3) : ouvre exactement l'aperçu affiché, sans pièces.
    const credit = (await post('/api/pass/claim', token, { tier: 3, track: 'premium' })).json();
    expect(credit.reward).toEqual({ type: 'preview_booster', count: 1 });
    expect(credit.wallet.previewBoosters).toBe(1);
    const preview = (await get('/api/boosters', token)).json().types[0].preview.cardIds as string[];
    const opened = await post('/api/boosters/base/redeem', token, { cardIds: preview });
    expect(opened.json().cards).toEqual(preview);
    expect(opened.json().wallet).toMatchObject({ coins: 0, previewBoosters: 0 });
    expect((await post('/api/boosters/base/redeem', token, { cardIds: opened.json().preview.cardIds })).json().error).toBe('no_preview_booster');

    // Passage au deluxe : variante exclusive, affichée sur la carte.
    await buy(token, 'pass_upgrade');
    expect((await pass(token)).track).toBe('deluxe');
    const variant = (await post('/api/pass/claim', token, { tier: 2, track: 'deluxe' })).json().reward;
    expect(variant.type).toBe('variant');
    expect(DEFAULT_PASS.deluxeVariants).toContain(variant.variant);
    expect((await post('/api/cosmetics/variant', token, { cardId: variant.cardId, variant: variant.variant })).statusCode).toBe(200);
    expect((await post('/api/cosmetics/variant', token, { cardId: variant.cardId, variant: 'holo' })).statusCode).toBe(403);
    const cosmetics = (await get('/api/cosmetics', token)).json();
    expect(cosmetics.variants).toContainEqual({ cardId: variant.cardId, variant: variant.variant, equipped: true });
    expect(cosmetics.activeTitle).toBe(title.id);
  });

  it('remboursement : la piste redevient celle des achats encore valables', async () => {
    t = await startApp();
    const { token } = await signup(t.app);
    await buy(token, 'pass_premium');
    await buy(token, 'pass_upgrade');
    expect((await pass(token)).track).toBe('deluxe');
    const [premium] = await t.db.query<{ provider_transaction_id: string }>("SELECT provider_transaction_id FROM transactions WHERE product_id = 'pass_premium'");
    const signer = new SandboxProvider(testConfig().payments.sandboxSecret, async () => {});
    const event = JSON.stringify({ id: 'evt_refund_pass', type: 'refunded', providerTransactionId: premium!.provider_transaction_id });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/webhooks/payment/sandbox',
      payload: event,
      headers: { 'content-type': 'application/json', 'x-sandbox-signature': signer.sign(event) },
    });
    expect(res.json().result).toBe('applied');
    // Le passage au deluxe seul ne donne pas le deluxe sans le premium.
    expect((await pass(token)).track).toBe('free');
  });

  it('points de pass : fin de partie en ligne et missions réclamées', async () => {
    t = await startApp({ missions: { dailyCount: 1, weeklyCount: 0, daily: [{ kind: 'open_booster', target: 1, coins: 30, xp: 80 }], weekly: [] } });
    const { token } = await signupWithKit(t.app);
    const deckId = (await get('/api/decks', token)).json().decks[0].id as string;
    const client = await TestClient.connect(t.url, token);
    clients.push(client);
    await client.wait('hello');
    client.send({ t: 'queue', deckId, mode: 'ghost' });
    await client.wait('match_start');
    client.act({ type: 'fold' });
    await client.wait('match_end');
    expect((await pass(token)).xp).toBe(DEFAULT_PASS.matchXp.loss);

    const [mission] = (await get('/api/missions', token)).json().daily.missions;
    await post('/api/boosters/base/open-free', token);
    await post(`/api/missions/${mission.id}/claim`, token);
    expect((await pass(token)).xp).toBe(DEFAULT_PASS.matchXp.loss + 80);
  });
});
