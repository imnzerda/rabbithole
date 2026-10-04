import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogSnapshot } from '../src/catalog/catalog.js';
import { DEFAULT_TRENDING, type TrendingConfig } from '../src/config.js';
import { activeTrending, computeTrending, dateKey, publishTrending, TrendingScheduler, type ViewsSource } from '../src/trending/trending.js';
import { auth, signupPayload, signupWithKit, startApp, TestClient } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (t) await t.app.close();
  t = null;
});

const config: TrendingConfig = { ...DEFAULT_TRENDING, enabled: true, count: 3 };
const NOW = new Date('2026-10-04T06:05:00Z');

/** 12 cartes du prototype reliées à des sujets Wikidata ; la carte i fait (i + 1) fois ses vues habituelles hier. */
async function setup(): Promise<{ snapshot: CatalogSnapshot; ids: string[]; source: ViewsSource }> {
  const base = t!.catalog.current;
  const cards = base.collectibles.slice(0, 12).map((c, i) => ({ ...c, wikidataId: `Q900${i}` }));
  for (const [i, c] of cards.entries()) {
    const death = i === 10 ? '2026-09-25' : null; // décès récent : exclu d'office
    await t!.db.query("INSERT INTO candidates (qid, run_series, data) VALUES ($1, 'test', $2)", [c.wikidataId, JSON.stringify({ wikis: { en: `Title ${i}`, fr: `Titre ${i}` }, death })]);
  }
  await t!.db.query("INSERT INTO trending_watchlist (card_id, reason) VALUES ($1, 'drame')", [cards[11]!.id]);
  const source: ViewsSource = async (lang, titles) =>
    new Map(
      titles.map((title) => {
        const i = Number(title.split(' ')[1]);
        // En anglais : 1 000 vues par jour, puis (i + 1) × 1 000 hier ; la carte 0 reste sous le minimum.
        const usual = lang === 'en' ? 1000 : 0;
        const yesterday = lang === 'en' ? (i === 0 ? 500 : (i + 1) * 1000) : 0;
        return [title, [...Array<number>(30).fill(i === 0 && lang === 'en' ? 400 : usual), yesterday]];
      }),
    );
  return { snapshot: { ...base, collectibles: cards, leaders: [] }, ids: cards.map((c) => c.id), source };
}

describe('Tendance du jour', () => {
  it('calcul : score veille / moyenne, minimum de vues, liste de surveillance et décès récents exclus ; publication', async () => {
    t = await startApp();
    const { snapshot, ids, source } = await setup();
    await computeTrending(t.db, config, snapshot, source, NOW);
    const rows = await t.db.query<{ card_id: string; score: number; excluded_reason: string | null }>(
      'SELECT card_id, score, excluded_reason FROM trending WHERE date = $1 ORDER BY score DESC',
      [dateKey(NOW)],
    );
    expect(rows.map((r) => [r.card_id, r.excluded_reason])).toEqual([
      [ids[11], 'watchlist'],
      [ids[10], 'recent_death'],
      [ids[9], null],
      [ids[8], null],
      [ids[7], null],
    ]);
    expect(rows[2]!.score).toBe(10);
    // Rien n'est actif avant la publication.
    expect(await activeTrending(t.db, NOW)).toEqual([]);
    await publishTrending(t.db, dateKey(NOW));
    expect(await activeTrending(t.db)).toEqual([ids[9], ids[8], ids[7]]);
  });

  it('ordonnanceur : calcul à 6 h UTC, publication à 6 h 30', async () => {
    t = await startApp();
    const { snapshot, source } = await setup();
    const scheduler = new TrendingScheduler(t.db, config, () => snapshot, source, () => {});
    const run = async () => (await t!.db.query<{ published_at: string | null }>("SELECT published_at FROM trending_runs WHERE date = '2026-10-04'"))[0];
    await scheduler.tick(new Date('2026-10-04T05:59:00Z'));
    expect(await run()).toBeUndefined();
    await scheduler.tick(new Date('2026-10-04T06:01:00Z'));
    expect((await run())?.published_at).toBeNull();
    await scheduler.tick(new Date('2026-10-04T06:31:00Z'));
    expect((await run())?.published_at).not.toBeNull();
  });

  it('joueurs et admin : liste publiée, carte écartée par l’admin, liste de surveillance', async () => {
    t = await startApp({ adminEmails: ['tendances@example.com'] });
    const { snapshot, ids, source } = await setup();
    await computeTrending(t.db, config, snapshot, source);
    await publishTrending(t.db, dateKey(new Date()));
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload('tendances', { email: 'tendances@example.com' }) });
    const token = res.cookies.find((c) => c.name === 'rh_session')!.value;
    const get = (url: string) => t!.app.inject({ method: 'GET', url, headers: auth(token) });
    const post = (url: string, payload: unknown) => t!.app.inject({ method: 'POST', url, headers: auth(token), payload: payload as object });

    expect((await get('/api/trending')).json().cards.map((c: { cardId: string }) => c.cardId)).toEqual([ids[9], ids[8], ids[7]]);
    const admin = (await get('/api/admin/trending')).json();
    expect(admin.cards).toHaveLength(5);
    expect(admin.watchlist).toEqual([{ cardId: ids[11], reason: 'drame' }]);

    expect((await post('/api/admin/trending/exclude', { date: dateKey(new Date()), cardId: ids[9], excluded: true })).statusCode).toBe(200);
    expect(await activeTrending(t.db)).toEqual([ids[8], ids[7]]);
    expect((await post('/api/admin/trending/watchlist', { cardId: ids[1], reason: 'actualité' })).statusCode).toBe(200);
    expect((await get('/api/admin/trending')).json().watchlist).toHaveLength(2);
  });

  it('partie en ligne : les cartes en tendance sont enregistrées et rendues au replay', async () => {
    t = await startApp();
    const { snapshot, ids, source } = await setup();
    await computeTrending(t.db, config, snapshot, source);
    await publishTrending(t.db, dateKey(new Date()));
    const { token } = await signupWithKit(t.app);
    const deckId = (await t.app.inject({ method: 'GET', url: '/api/decks', headers: auth(token) })).json().decks[0].id as string;
    const client = await TestClient.connect(t.url, token);
    clients.push(client);
    await client.wait('hello');
    client.send({ t: 'queue', deckId, mode: 'ghost' });
    const start = await client.wait('match_start');
    if (start.t !== 'match_start') throw new Error('match_start attendu');
    client.act({ type: 'fold' });
    await client.wait('match_end');
    await t.matches.flush();
    const [row] = await t.db.query<{ trending: string[] }>('SELECT trending FROM matches WHERE id = $1', [start.matchId]);
    expect(row!.trending).toEqual([ids[9], ids[8], ids[7]]);
    const replay = (await t.app.inject({ method: 'GET', url: `/api/replays/${start.matchId}`, headers: auth(token) })).json().replay;
    expect(replay.trending).toEqual([ids[9], ids[8], ids[7]]);
  });
});
