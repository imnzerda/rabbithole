import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ACHIEVEMENTS } from '../src/config.js';
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
const list = async (token: string) => (await get('/api/achievements', token)).json();
const find = (all: { achievements: { id: string }[] }, id: string) => all.achievements.find((a) => a.id === id) as Record<string, unknown>;
const giveCards = async (userId: string, ids: string[]) => {
  for (const id of ids) await t!.db.query('INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING', [userId, id]);
};

describe('succès et progression de collection', () => {
  it('nouveau compte : rien d’atteint, rien à réclamer', async () => {
    t = await startApp();
    const { token } = await signup(t.app);
    const all = await list(token);
    expect(all.collection).toMatchObject({ points: 0, level: 0, claimable: 0 });
    expect(all.achievements.every((a: { unlocked: boolean }) => !a.unlocked)).toBe(true);
    // Un « Spécialiste » par catégorie, en plus des succès de la config.
    expect(all.achievements.filter((a: { id: string }) => a.id.startsWith('specialist_')).length).toBe(10);
    expect((await post('/api/achievements/games_1/claim', token)).json().error).toBe('achievement_locked');
    expect((await post('/api/achievements/collection/claim', token)).json().error).toBe('nothing_to_claim');
    expect((await post('/api/achievements/inconnu/claim', token)).statusCode).toBe(404);
  });

  it('collection : succès réclamé une fois ; niveaux de progression (pièces et boosters gratuits)', async () => {
    t = await startApp();
    const { token, id } = await signup(t.app);
    await giveCards(id, t.catalog.current.collectibles.slice(0, 25).map((c) => c.id));
    const all = await list(token);
    expect(find(all, 'cards_25')).toMatchObject({ progress: 25, unlocked: true, claimed: false });
    const claimed = await post('/api/achievements/cards_25/claim', token);
    expect(claimed.json().reward).toEqual({ coins: 50, title: null });
    expect(claimed.json().wallet.coins).toBe(50);
    expect((await post('/api/achievements/cards_25/claim', token)).json().error).toBe('already_claimed');
    expect(find(await list(token), 'cards_25').claimed).toBe(true);

    // 25 cartes × 10 points = 250 : niveau 1.
    const { collection } = await list(token);
    expect(collection).toMatchObject({ points: 25 * DEFAULT_ACHIEVEMENTS.collection.pointsPerCard, level: 1, claimable: 1 });
    const levels = await post('/api/achievements/collection/claim', token);
    expect(levels.json().reward).toEqual({ levels: 1, coins: 50, freeBoosters: 1 });
    expect(levels.json().wallet).toMatchObject({ coins: 100, freeBoosters: DEFAULT_ACHIEVEMENTS.collection.reward.freeBoosters + 6 });
    expect((await post('/api/achievements/collection/claim', token)).json().error).toBe('nothing_to_claim');
  });

  it('« Spécialiste » : toutes les cartes d’une catégorie, avec un titre', async () => {
    t = await startApp();
    const { token, id } = await signup(t.app);
    const cards = [...t.catalog.current.collectibles, ...t.catalog.current.leaders].filter((c) => c.categories.includes('exploration'));
    await giveCards(id, cards.slice(1).map((c) => c.id));
    expect(find(await list(token), 'specialist_exploration')).toMatchObject({ unlocked: false, progress: cards.length - 1, target: cards.length });
    await giveCards(id, [cards[0]!.id]);
    const reward = (await post('/api/achievements/specialist_exploration/claim', token)).json().reward;
    expect(reward.title.fr).toMatch(/^Spécialiste /);
    const titles = (await get('/api/cosmetics', token)).json().titles.map((x: { id: string }) => x.id);
    expect(titles).toContain('achievement_specialist_exploration');
  });

  it('parties en ligne : comptées pour les succès et la progression', async () => {
    t = await startApp();
    const { token } = await signupWithKit(t.app);
    const before = (await list(token)).collection.points;
    const deckId = (await get('/api/decks', token)).json().decks[0].id as string;
    const client = await TestClient.connect(t.url, token);
    clients.push(client);
    await client.wait('hello');
    client.send({ t: 'queue', deckId, mode: 'ghost' });
    await client.wait('match_start');
    client.act({ type: 'fold' });
    await client.wait('match_end');
    await t.matches.flush();
    const all = await list(token);
    expect(find(all, 'games_1')).toMatchObject({ progress: 1, unlocked: true });
    expect(find(all, 'wins_1')).toMatchObject({ progress: 0, unlocked: false });
    expect(all.collection.points).toBe(before + DEFAULT_ACHIEVEMENTS.collection.pointsPerGame);
  });
});
