import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MISSIONS, type MissionsConfig } from '../src/config.js';
import { periods, recordMission } from '../src/retention/missions.js';
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

/** Config où chaque période ne propose que les missions voulues (le tirage devient prévisible). */
const only = (daily: MissionsConfig['daily'], weekly: MissionsConfig['weekly'] = []): MissionsConfig => ({ dailyCount: daily.length, weeklyCount: weekly.length, daily, weekly });

describe('missions', () => {
  it('périodes : jour UTC et semaine du lundi', () => {
    const p = periods(new Date('2026-10-03T22:30:00Z')); // un samedi
    expect(p.daily).toEqual({ key: '2026-10-03', endsAt: new Date('2026-10-04T00:00:00Z') });
    expect(p.weekly).toEqual({ key: '2026-09-28', endsAt: new Date('2026-10-05T00:00:00Z') });
    expect(periods(new Date('2026-09-28T00:00:00Z')).weekly.key).toBe('2026-09-28');
  });

  it('3 quotidiennes et 3 hebdomadaires, distinctes, tirées une fois par période', async () => {
    t = await startApp();
    const { token } = await signup(t.app);
    const first = (await get('/api/missions', token)).json();
    expect(first.daily.missions).toHaveLength(DEFAULT_MISSIONS.dailyCount);
    expect(first.weekly.missions).toHaveLength(DEFAULT_MISSIONS.weeklyCount);
    expect(new Set(first.daily.missions.map((m: { kind: string }) => m.kind)).size).toBe(DEFAULT_MISSIONS.dailyCount);
    for (const m of [...first.daily.missions, ...first.weekly.missions]) {
      expect(m.progress).toBe(0);
      expect(m.category === null).toBe(m.kind !== 'play_category');
    }
    expect((await get('/api/missions', token)).json()).toEqual(first);
  });

  it('progression côté serveur, réclamation unique, pièces créditées', async () => {
    t = await startApp({
      missions: only([
        { kind: 'open_booster', target: 1, coins: 30, xp: 80 },
        { kind: 'craft', target: 2, coins: 50, xp: 100 },
      ]),
    });
    const { token } = await signup(t.app);
    const missions = (await get('/api/missions', token)).json().daily.missions as { id: string; kind: string }[];
    const booster = missions.find((m) => m.kind === 'open_booster')!;
    const craft = missions.find((m) => m.kind === 'craft')!;
    expect((await post(`/api/missions/${booster.id}/claim`, token)).json().error).toBe('mission_not_claimable');

    await post('/api/boosters/base/open-free', token);
    const after = (await get('/api/missions', token)).json().daily.missions;
    expect(after.find((m: { id: string }) => m.id === booster.id).progress).toBe(1);
    const claimed = await post(`/api/missions/${booster.id}/claim`, token);
    expect(claimed.json().reward).toEqual({ coins: 30, xp: 80 });
    expect(claimed.json().wallet.coins).toBe(30);
    expect((await post(`/api/missions/${booster.id}/claim`, token)).statusCode).toBe(409);
    expect((await get('/api/missions', token)).json().daily.missions.find((m: { id: string }) => m.id === booster.id).claimed).toBe(true);
    expect((await post(`/api/missions/${craft.id}/claim`, token)).statusCode).toBe(409);
  });

  it('mission de catégorie : seules les cartes de cette catégorie comptent ; la progression ne dépasse pas l’objectif', async () => {
    const config = only([{ kind: 'play_category', target: 5, coins: 50, xp: 120 }]);
    t = await startApp({ missions: config });
    const { token, id } = await signup(t.app);
    const [m] = (await get('/api/missions', token)).json().daily.missions;
    const other = m.category === 'sport' ? 'musique' : 'sport';
    await recordMission(t.db, id, 'play_category', 3, config, other);
    expect((await get('/api/missions', token)).json().daily.missions[0].progress).toBe(0);
    await recordMission(t.db, id, 'play_category', 9, config, m.category);
    expect((await get('/api/missions', token)).json().daily.missions[0].progress).toBe(5);
  });

  it('fin de partie en ligne : partie jouée comptée (contre un fantôme aussi)', async () => {
    t = await startApp({ missions: only([{ kind: 'play', target: 2, coins: 40, xp: 100 }], [{ kind: 'play', target: 15, coins: 200, xp: 500 }]) });
    const { token } = await signupWithKit(t.app);
    const deckId = (await get('/api/decks', token)).json().decks[0].id as string;
    const client = await TestClient.connect(t.url, token);
    clients.push(client);
    await client.wait('hello');
    client.send({ t: 'queue', deckId, mode: 'ghost' });
    await client.wait('match_start');
    client.act({ type: 'fold' });
    await client.wait('match_end');
    const missions = (await get('/api/missions', token)).json();
    expect(missions.daily.missions[0].progress).toBe(1);
    expect(missions.weekly.missions[0].progress).toBe(1);
  });
});
