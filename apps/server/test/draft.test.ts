import { validateDeck } from '@rabbithole/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT } from '../src/config.js';
import { draftOpen, draftWeek } from '../src/retention/draft.js';
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
const post = (url: string, token: string, payload: object = {}) => t!.app.inject({ method: 'POST', url, headers: auth(token), payload });

/** Choisit le Leader puis la première carte de chaque proposition jusqu'au deck complet. */
async function draftAll(token: string) {
  let draft = (await get('/api/draft', token)).json();
  draft = (await post('/api/draft/pick', token, { cardId: draft.run.leaderChoices[0] })).json().draft;
  while (draft.run.status === 'picking') draft = (await post('/api/draft/pick', token, { cardId: draft.run.offer[0] })).json().draft;
  return draft;
}

describe('draft du week-end', () => {
  it('ouverture le week-end (UTC) et clé de semaine = samedi', () => {
    const closed = { ...DEFAULT_DRAFT, alwaysOpen: false };
    expect(draftOpen(closed, new Date('2026-10-03T10:00:00Z'))).toBe(true); // samedi
    expect(draftOpen(closed, new Date('2026-10-04T23:59:00Z'))).toBe(true); // dimanche
    expect(draftOpen(closed, new Date('2026-10-05T00:00:00Z'))).toBe(false); // lundi
    expect(draftWeek(new Date('2026-10-03T10:00:00Z'))).toBe('2026-10-03');
    expect(draftWeek(new Date('2026-10-04T22:00:00Z'))).toBe('2026-10-03');
    expect(draftWeek(new Date('2026-10-09T22:00:00Z'))).toBe('2026-10-03'); // vendredi suivant
    expect(draftWeek(new Date('2026-10-10T01:00:00Z'))).toBe('2026-10-10');
  });

  it('entrée gratuite une fois, puis en pièces ; propositions valides ; deck complet et jouable', async () => {
    t = await startApp();
    const { token, id } = await signup(t.app);
    const ctx = t.catalog.current.ctx;
    const before = (await get('/api/draft', token)).json();
    expect(before).toMatchObject({ open: true, freeLeft: 1, entryCoins: DEFAULT_DRAFT.entryCoins, run: null });

    const started = (await post('/api/draft/start', token, { pay: 'free' })).json();
    expect(started.draft.freeLeft).toBe(0);
    const run = started.draft.run;
    expect(run).toMatchObject({ status: 'picking', entry: 'free', leader: null, picks: [] });
    expect(run.leaderChoices).toHaveLength(DEFAULT_DRAFT.leaderChoices);
    for (const l of run.leaderChoices) expect(ctx.cards[l]!.type).toBe('leader');
    // Un seul draft à la fois ; une carte non proposée est refusée.
    expect((await post('/api/draft/start', token, { pay: 'coins' })).json().error).toBe('draft_in_progress');
    expect((await post('/api/draft/pick', token, { cardId: 'inconnue' })).json().error).toBe('not_offered');

    const done = await draftAll(token);
    expect(done.run.status).toBe('playing');
    expect(done.run.picks).toHaveLength(ctx.rules.deckSize);
    expect(validateDeck(ctx, done.run.leader, done.run.picks)).toEqual([]);
    const [audit] = await t.db.query<{ seed: string }>('SELECT seed FROM draft_runs WHERE user_id = $1', [id]);
    expect(audit!.seed).toMatch(/^[0-9a-f]{32}$/);

    // Abandon : récompense des victoires obtenues (0) ; nouvelle entrée en pièces seulement.
    const retired = (await post('/api/draft/retire', token)).json();
    expect(retired.reward).toEqual(DEFAULT_DRAFT.rewards[0]);
    expect(retired.wallet.coins).toBe(DEFAULT_DRAFT.rewards[0]!.coins);
    expect((await post('/api/draft/start', token, { pay: 'free' })).json().error).toBe('no_free_draft');
    expect((await post('/api/draft/start', token, { pay: 'coins' })).json().error).toBe('not_enough_coins');
  });

  it('parties de draft contre un fantôme : défaites comptées, fin du draft et récompense', async () => {
    t = await startApp({ ghostDelayMs: 50 });
    const { token } = await signup(t.app);
    await post('/api/draft/start', token, { pay: 'free' });
    const drafted = await draftAll(token);

    const client = await TestClient.connect(t.url, token);
    clients.push(client);
    await client.wait('hello');
    for (let loss = 1; loss <= DEFAULT_DRAFT.maxLosses; loss++) {
      client.messages.length = 0;
      client.send({ t: 'draft' });
      const start = await client.wait('match_start');
      if (start.t !== 'match_start') throw new Error('match_start attendu');
      const [row] = await t.db.query<{ mode: string; players: { leader: string; deck: string[] }[] }>('SELECT mode, players FROM matches WHERE id = $1', [start.matchId]);
      expect(row!.mode).toBe('draft');
      expect(row!.players[0]).toMatchObject({ leader: drafted.run.leader, deck: drafted.run.picks });
      client.act({ type: 'fold' });
      const end = await client.wait('match_end');
      if (end.t !== 'match_end') throw new Error('match_end attendu');
      await t.matches.flush();
      // Pas de pièces par partie ; la récompense tombe avec la dernière défaite.
      expect(end.reward).toBe(loss === DEFAULT_DRAFT.maxLosses ? DEFAULT_DRAFT.rewards[0]!.coins : null);
    }
    const after = (await get('/api/draft', token)).json();
    expect(after.run).toMatchObject({ status: 'done', wins: 0, losses: DEFAULT_DRAFT.maxLosses, reward: DEFAULT_DRAFT.rewards[0] });
    // Draft terminé : plus de partie de draft possible.
    client.messages.length = 0;
    client.send({ t: 'draft' });
    const error = await client.wait('error');
    if (error.t !== 'error') throw new Error('erreur attendue');
    expect(error.code).toBe('no_draft');
  });
});
