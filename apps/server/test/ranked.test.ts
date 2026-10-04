import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RANKED } from '../src/config.js';
import { applyRankedResult, getRanked, leaderboard, rankOf, seasonOf } from '../src/ranked/ranked.js';
import { auth, signupPayload, signupWithKit, startApp, TestClient } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (t) await t.app.close();
  t = null;
});

const get = (url: string, token: string) => t!.app.inject({ method: 'GET', url, headers: auth(token) });
let n = 0;
async function player(country = 'FR'): Promise<{ token: string; id: string }> {
  const res = await t!.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload(`classe${++n}`, { country }) });
  expect(res.statusCode).toBe(201);
  return { token: res.cookies.find((c) => c.name === 'rh_session')!.value, id: res.json().user.id };
}
const setPoints = (id: string, season: string, points: number, games = 1) =>
  t!.db.query(
    `INSERT INTO ranked (user_id, season, points, best_points, wins) VALUES ($1, $2, $3, $3, $4)
     ON CONFLICT (user_id, season) DO UPDATE SET points = EXCLUDED.points, best_points = EXCLUDED.best_points, wins = EXCLUDED.wins`,
    [id, season, points, games],
  );

describe('classé', () => {
  it('saisons mensuelles (UTC) et rangs par points', () => {
    expect(seasonOf(new Date('2026-10-31T23:59:00Z'))).toEqual({ key: '2026-10', endsAt: new Date('2026-11-01T00:00:00Z') });
    expect(seasonOf(new Date('2026-12-15T00:00:00Z')).endsAt).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(rankOf(0, DEFAULT_RANKED).id).toBe('lurker');
    expect(rankOf(299, DEFAULT_RANKED).id).toBe('normie');
    expect(rankOf(1500, DEFAULT_RANKED).id).toBe('legende');
  });

  it('victoire, nul, défaite, multipliés par l’enjeu (Hype) ; une défaite ne fait pas redescendre sous le seuil du rang', async () => {
    t = await startApp();
    const p = await player();
    const season = seasonOf().key;
    expect(await applyRankedResult(t.db, p.id, 'win', 1, DEFAULT_RANKED)).toEqual({ before: 0, after: 25, delta: 25, rankBefore: 'lurker', rank: 'lurker' });
    expect((await applyRankedResult(t.db, p.id, 'draw', 1, DEFAULT_RANKED)).after).toBe(30);
    expect((await applyRankedResult(t.db, p.id, 'loss', 1, DEFAULT_RANKED)).after).toBe(15);
    expect((await applyRankedResult(t.db, p.id, 'loss', 1, DEFAULT_RANKED)).after).toBe(0);
    await setPoints(p.id, season, 110);
    // Normie (100) : la défaite s'arrête au seuil.
    expect(await applyRankedResult(t.db, p.id, 'loss', 1, DEFAULT_RANKED)).toMatchObject({ before: 110, after: 100, delta: -10, rank: 'normie' });
    expect((await applyRankedResult(t.db, p.id, 'win', 1, DEFAULT_RANKED)).rankBefore).toBe('normie');
    // Hype : l'enjeu multiplie les points (×4 ici).
    expect((await applyRankedResult(t.db, p.id, 'win', 4, DEFAULT_RANKED)).delta).toBe(4 * DEFAULT_RANKED.win);
    expect((await applyRankedResult(t.db, p.id, 'loss', 2, DEFAULT_RANKED)).delta).toBe(-2 * DEFAULT_RANKED.loss);
  });

  it('nouvelle saison : reset partiel, récompense du meilleur rang passé (pièces, titre, notification), une seule fois', async () => {
    t = await startApp();
    const p = await player();
    await setPoints(p.id, '2026-09', 1200);
    await t.db.query("UPDATE ranked SET best_points = 1600 WHERE user_id = $1 AND season = '2026-09'", [p.id]);
    const october = new Date('2026-10-10T12:00:00Z');
    const me = await getRanked(t.db, { id: p.id, country: 'FR' }, DEFAULT_RANKED, october);
    expect(me).toMatchObject({ season: '2026-10', points: 600, rank: 'influenceur', next: { rank: 'viral', min: 1000 }, position: null });
    expect((await get('/api/wallet', p.token)).json().wallet.coins).toBe(2000);
    const cosmetics = (await get('/api/cosmetics', p.token)).json();
    expect(cosmetics.titles.map((x: { id: string }) => x.id)).toEqual(['ranked_2026-09_legende']);
    expect((await get('/api/notices', p.token)).json().notices[0]).toMatchObject({ kind: 'ranked_season', payload: { season: '2026-09', rank: 'legende', coins: 2000 } });
    await getRanked(t.db, { id: p.id, country: 'FR' }, DEFAULT_RANKED, october);
    expect((await get('/api/wallet', p.token)).json().wallet.coins).toBe(2000);
  });

  it('partie classée entre deux joueurs : points annoncés en fin de partie, positions', async () => {
    t = await startApp();
    const a = await signupWithKit(t.app);
    const b = await signupWithKit(t.app);
    const deckOf = async (token: string) => (await get('/api/decks', token)).json().decks[0].id as string;
    const ca = await TestClient.connect(t.url, a.token);
    const cb = await TestClient.connect(t.url, b.token);
    clients.push(ca, cb);
    await Promise.all([ca.wait('hello'), cb.wait('hello')]);
    ca.send({ t: 'queue', deckId: await deckOf(a.token), mode: 'ranked' });
    await ca.wait('queued');
    cb.send({ t: 'queue', deckId: await deckOf(b.token), mode: 'ranked' });
    await Promise.all([ca.wait('match_start'), cb.wait('match_start')]);
    ca.act({ type: 'fold' });
    const [endA, endB] = await Promise.all([ca.wait('match_end'), cb.wait('match_end')]);
    if (endA.t !== 'match_end' || endB.t !== 'match_end') throw new Error('match_end attendu');
    expect(endA.ranked).toMatchObject({ before: 0, after: 0, delta: 0 });
    expect(endB.ranked).toMatchObject({ before: 0, after: DEFAULT_RANKED.win, delta: DEFAULT_RANKED.win });
    const rb = (await get('/api/ranked', b.token)).json();
    expect(rb).toMatchObject({ points: DEFAULT_RANKED.win, wins: 1, position: 1, countryPosition: 1 });
    expect((await get('/api/ranked', a.token)).json()).toMatchObject({ losses: 1, position: 2 });
  });

  it('classements mondial et par pays, top N, joueurs sans partie classée exclus', async () => {
    t = await startApp();
    const season = seasonOf().key;
    const fr = await player('FR');
    const us = await player('US');
    const idle = await player('FR');
    await setPoints(fr.id, season, 700);
    await setPoints(us.id, season, 900);
    await setPoints(idle.id, season, 1200, 0);
    const world = (await get('/api/ranked/leaderboard', fr.token)).json().entries;
    expect(world.map((e: { points: number; country: string }) => [e.points, e.country])).toEqual([
      [900, 'US'],
      [700, 'FR'],
    ]);
    expect(world[1]).toMatchObject({ position: 2, rank: 'influenceur', you: true });
    const france = (await get('/api/ranked/leaderboard?country=FR', fr.token)).json().entries;
    expect(france).toHaveLength(1);
    expect(france[0]).toMatchObject({ position: 1, country: 'FR' });
    expect((await leaderboard(t.db, fr.id, null, 1, DEFAULT_RANKED)).length).toBe(1);
    expect((await get('/api/ranked/leaderboard?country=fr', fr.token)).statusCode).toBe(400);
  });
});
