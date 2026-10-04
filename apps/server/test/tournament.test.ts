import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TOURNAMENT, type TournamentConfig } from '../src/config.js';
import { getTournaments, nextStart, registerTournament, resolveDueRounds, startDueTournaments } from '../src/tournament/tournament.js';
import { auth, signupWithKit, startApp, TestClient } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (t) await t.app.close();
  t = null;
});

const config: TournamentConfig = { ...DEFAULT_TOURNAMENT, enabled: false };
// Semaine du tournoi du samedi 10 octobre 2026, 12 h UTC.
const monday = new Date('2026-10-05T10:00:00Z');
const start = new Date('2026-10-10T12:00:00Z');
const hours = (h: number) => new Date(start.getTime() + h * 3_600_000);

/** Joueurs inscrits avec le premier deck de leur kit. */
async function players(n: number) {
  const out: { id: string; token: string }[] = [];
  for (let i = 0; i < n; i++) {
    const { id, token } = await signupWithKit(t!.app, `tournoi${i}`);
    const deckId = (await t!.app.inject({ method: 'GET', url: '/api/decks', headers: auth(token) })).json().decks[0].id as string;
    await registerTournament(t!.db, { id }, deckId, t!.catalog.current.ctx, new Set(), config, monday);
    out.push({ id, token });
  }
  return out;
}

const coins = async (userId: string) => (await t!.db.query<{ coins: number }>('SELECT coins FROM wallets WHERE user_id = $1', [userId]))[0]!.coins;

describe('tournoi hebdomadaire', () => {
  it('début le samedi à 12 h UTC', () => {
    expect(nextStart(config, new Date('2026-10-04T20:00:00Z')).toISOString()).toBe('2026-10-10T12:00:00.000Z');
    expect(nextStart(config, new Date('2026-10-10T11:59:00Z')).toISOString()).toBe('2026-10-10T12:00:00.000Z');
    expect(nextStart(config, new Date('2026-10-10T12:00:00Z')).toISOString()).toBe('2026-10-17T12:00:00.000Z');
  });

  it('3 joueurs : tableau de 4 avec une exemption, tours tranchés à l’échéance, classement, récompenses, titre', async () => {
    t = await startApp();
    const ps = await players(3);
    const before = await Promise.all(ps.map((p) => coins(p.id)));
    const registering = await getTournaments(t.db, ps[0]!.id, config, monday);
    expect(registering.next).toMatchObject({ status: 'registering', startDate: '2026-10-10', players: 3, registered: { cards: 20 } });

    await startDueTournaments(t.db, config, start);
    let view = (await getTournaments(t.db, ps[0]!.id, config, hours(1))).current!;
    expect(view).toMatchObject({ status: 'running', round: 1, rounds: 2, roundEndsAt: hours(6).toISOString() });
    expect(view.bracket[0]).toHaveLength(2);
    expect(view.bracket[0]!.filter((s) => s.how === 'bye')).toHaveLength(1);
    const [audit] = await t.db.query<{ seed: string }>('SELECT seed FROM tournaments WHERE start_date = $1', ['2026-10-10']);
    expect(audit!.seed).toMatch(/^[0-9a-f]{32}$/);

    // Avant l'échéance, rien ne bouge ; à l'échéance, le match non joué est simulé et la finale commence.
    await resolveDueRounds(t.db, t.catalog.current.ctx, config, hours(5));
    expect((await getTournaments(t.db, ps[0]!.id, config, hours(5))).current!.round).toBe(1);
    await resolveDueRounds(t.db, t.catalog.current.ctx, config, hours(6));
    view = (await getTournaments(t.db, ps[0]!.id, config, hours(6))).current!;
    expect(view.round).toBe(2);
    expect(view.bracket[0]!.find((s) => s.how !== 'bye')!.how).toBe('simulated');
    expect(view.bracket[1]).toHaveLength(1);

    await resolveDueRounds(t.db, t.catalog.current.ctx, config, hours(12));
    const tops = await t.db.query<{ user_id: string; top: number; reward_coins: number }>('SELECT user_id, top, reward_coins FROM tournament_players ORDER BY top');
    expect(tops.map((r) => r.top)).toEqual([1, 2, 4]);
    const reward = (top: number) => config.rewards.find((r) => r.top === top)!.coins;
    for (const r of tops) expect(await coins(r.user_id)).toBe(before[ps.findIndex((p) => p.id === r.user_id)]! + reward(r.top));
    const champion = tops[0]!.user_id;
    const [title] = await t.db.query<{ title_id: string }>('SELECT title_id FROM user_titles WHERE user_id = $1', [champion]);
    expect(title!.title_id).toBe('tournament_2026-10-10');
    const done = (await getTournaments(t.db, champion, config, hours(13))).current!;
    expect(done).toMatchObject({ status: 'done', result: { top: 1, reward: { coins: reward(1) } } });
  });

  it('match joué en direct : les deux joueurs se retrouvent, le vainqueur passe, le tournoi se termine', async () => {
    t = await startApp();
    const [a, b] = await players(2);
    await startDueTournaments(t.db, config, start);
    // Le tournoi est démarré à une date simulée : on recale l'échéance pour que la partie en direct ait lieu dans le tour.
    await t.db.query("UPDATE tournaments SET round_ends_at = now() + interval '6 hours'");

    const ca = await TestClient.connect(t.url, a!.token);
    const cb = await TestClient.connect(t.url, b!.token);
    clients.push(ca, cb);
    await ca.wait('hello');
    await cb.wait('hello');
    ca.send({ t: 'tournament' });
    const queued = await ca.wait('queued');
    if (queued.t !== 'queued') throw new Error('queued attendu');
    expect(queued).toMatchObject({ mode: 'tournament', ghostInMs: null });
    cb.send({ t: 'tournament' });
    const start_ = await cb.wait('match_start');
    await ca.wait('match_start');
    if (start_.t !== 'match_start') throw new Error('match_start attendu');
    const [row] = await t.db.query<{ mode: string }>('SELECT mode FROM matches WHERE id = $1', [start_.matchId]);
    expect(row!.mode).toBe('tournament');

    cb.act({ type: 'fold' });
    const end = await ca.wait('match_end');
    if (end.t !== 'match_end') throw new Error('match_end attendu');
    await t.matches.flush();
    const tops = await t.db.query<{ user_id: string; top: number }>('SELECT user_id, top FROM tournament_players ORDER BY top');
    expect(tops).toEqual([
      { user_id: a!.id, top: 1 },
      { user_id: b!.id, top: 2 },
    ]);
    const [slot] = await t.db.query<{ how: string; match_id: string }>('SELECT how, match_id FROM tournament_matches');
    expect(slot).toMatchObject({ how: 'played', match_id: start_.matchId });

    // Plus de match à jouer.
    ca.messages.length = 0;
    ca.send({ t: 'tournament' });
    const error = await ca.wait('error');
    if (error.t !== 'error') throw new Error('erreur attendue');
    expect(error.code).toBe('no_tournament_match');
  });

  it('moins de 2 inscrits : tournoi annulé', async () => {
    t = await startApp();
    const [solo] = await players(1);
    await startDueTournaments(t.db, config, start);
    const current = (await getTournaments(t.db, solo!.id, config, hours(1))).current!;
    expect(current).toMatchObject({ status: 'cancelled', bracket: [], result: null });
  });
});
