import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DAILY } from '../src/config.js';
import { dailyChallenge, dailyKey, dailyScore } from '../src/retention/daily.js';
import { auth, signup, startApp, TestClient } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (t) await t.app.close();
  t = null;
});

const get = (url: string, token: string) => t!.app.inject({ method: 'GET', url, headers: auth(token) });

/** Lance le défi du jour, abandonne aussitôt, renvoie le message de fin. */
async function playAndFold(token: string) {
  const client = await TestClient.connect(t!.url, token);
  clients.push(client);
  await client.wait('hello');
  client.send({ t: 'daily' });
  const start = await client.wait('match_start');
  client.act({ type: 'fold' });
  const end = await client.wait('match_end');
  await t!.matches.flush();
  return { client, start, end };
}

describe('défi du jour', () => {
  it('même deck, même adversaire, même seed pour tout le monde ; change d’un jour à l’autre', async () => {
    t = await startApp();
    const ctx = t.catalog.current.ctx;
    const a = await dailyChallenge(t.db, ctx, new Date('2026-10-04T08:00:00Z'));
    const b = await dailyChallenge(t.db, ctx, new Date('2026-10-04T23:00:00Z'));
    expect(a).toEqual(b);
    expect(a!.seed).toBe('daily:2026-10-04');
    expect(a!.deck.id).not.toBe(a!.opponent.id);
    expect(a!.deck.cards).toHaveLength(20);
    const days = await Promise.all(['05', '06', '07', '08'].map((d) => dailyChallenge(t!.db, ctx, new Date(`2026-10-${d}T08:00:00Z`))));
    expect(new Set(days.map((d) => `${d!.deck.id}/${d!.opponent.id}`)).size).toBeGreaterThan(1);
  });

  it('score : victoire, Vies restantes, Vies prises, moins les tours', () => {
    const s = DEFAULT_DAILY.score;
    const win = dailyScore({ winner: 0, reason: 'life', turns: 9, life: [3, 0], stake: 1 }, 0, 5, DEFAULT_DAILY);
    expect(win).toEqual({ won: true, turns: 9, livesLeft: 3, livesTaken: 5, score: s.win + 3 * s.lifeLeft + 5 * s.lifeTaken - 9 * s.perTurn });
    const loss = dailyScore({ winner: 1, reason: 'fold', turns: 2, life: [5, 5], stake: 1 }, 0, 5, DEFAULT_DAILY);
    expect(loss).toMatchObject({ won: false, livesTaken: 0, score: 5 * s.lifeLeft - 2 * s.perTurn });
    // Abandon pendant le mulligan : Vies pas encore distribuées, rien de pris.
    expect(dailyScore({ winner: 1, reason: 'fold', turns: 0, life: [0, 0], stake: 1 }, 0, 5, DEFAULT_DAILY)).toMatchObject({ livesTaken: 0, score: 0 });
  });

  it('partie du défi : deck imposé sans le posséder, seed du jour, une seule tentative, récompense et classement', async () => {
    t = await startApp();
    const { token } = await signup(t.app);
    const before = (await get('/api/daily', token)).json();
    expect(before).toMatchObject({ date: dailyKey(), result: null, position: null, players: 0 });
    expect(before.deck.cards).toHaveLength(20);

    const { client, start, end } = await playAndFold(token);
    if (start.t !== 'match_start' || end.t !== 'match_end') throw new Error('messages attendus');
    const [row] = await t.db.query<{ seed: string; mode: string }>('SELECT seed, mode FROM matches WHERE id = $1', [start.matchId]);
    expect(row).toEqual({ seed: `daily:${dailyKey()}`, mode: 'daily' });
    // Défaite par abandon : récompense de défaite du défi (pas les pièces de partie habituelles).
    expect(end.reward).toBe(DEFAULT_DAILY.reward.loss);
    expect((await get('/api/wallet', token)).json().wallet.coins).toBe(DEFAULT_DAILY.reward.loss);

    const after = (await get('/api/daily', token)).json();
    expect(after.result).toMatchObject({ won: false, livesTaken: 0 });
    expect(after).toMatchObject({ position: 1, players: 1 });
    expect(after.leaderboard[0]).toMatchObject({ position: 1, you: true, won: false });

    // Deuxième tentative refusée.
    client.messages.length = 0;
    client.send({ t: 'daily' });
    const error = await client.wait('error');
    if (error.t !== 'error') throw new Error('erreur attendue');
    expect(error.code).toBe('daily_done');
  });
});
