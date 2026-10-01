import { applyAction, createMatch } from '@rabbithole/engine';
import type { ReplayData } from '@rabbithole/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ctx } from '../src/content.js';
import { auth, autoPlay, signup, startApp, TestClient } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (t) await t.app.close();
  t = null;
});

async function player(app: Started) {
  const { token, id } = await signup(app.app);
  const decks = (await app.app.inject({ method: 'GET', url: '/api/decks', headers: auth(token) })).json().decks;
  const client = await TestClient.connect(app.url, token);
  clients.push(client);
  await client.wait('hello');
  return { token, id, deckId: decks[0].id as string, client };
}

/** Rejoue une partie enregistrée avec le moteur et renvoie l'état final. */
function replay(r: ReplayData) {
  let { state } = createMatch(ctx, {
    seed: r.seed,
    players: [
      { id: 'a', leader: r.players[0].leader, deck: r.players[0].deck },
      { id: 'b', leader: r.players[1].leader, deck: r.players[1].deck },
    ],
  });
  for (const { player: p, action } of r.actions) state = applyAction(ctx, state, p, action).state;
  return state;
}

describe('WebSocket /ws', () => {
  it('refuse une connexion sans session', async () => {
    t = await startApp();
    const client = await TestClient.connect(t.url, null);
    clients.push(client);
    const code = await new Promise<number>((resolve) => client.ws.once('close', (c) => resolve(c)));
    expect(code).toBe(4401);
  });

  it('deux joueurs : appariement, partie complète, vues sans fuite, enregistrement et replay exact', async () => {
    t = await startApp();
    const a = await player(t);
    const b = await player(t);
    a.client.send({ t: 'queue', deckId: a.deckId, mode: 'casual' });
    await a.client.wait('queued');
    b.client.send({ t: 'queue', deckId: b.deckId, mode: 'casual' });

    const [sa, sb] = await Promise.all([a.client.wait('match_start'), b.client.wait('match_start')]);
    expect(sa.matchId).toBe(sb.matchId);
    expect(new Set([sa.you, sb.you]).size).toBe(2);
    expect(sa.opponent.ghost).toBe(false);

    await Promise.all([autoPlay(a.client), autoPlay(b.client)]);
    const endA = await a.client.wait('match_end');
    const endB = await b.client.wait('match_end');
    expect(endA.result).toEqual(endB.result);

    // Aucune vue envoyée à A ne contient la main ni les Vies de B.
    for (const m of a.client.messages) {
      if (m.t !== 'step') continue;
      expect(m.view.you).toBe(sa.you);
      expect(m.view.opponent).not.toHaveProperty('hand');
      for (const e of m.events) if (e.type === 'card_drawn' && e.player !== sa.you) expect(e.uid).toBe('hidden');
    }

    await t.matches.flush();
    const list = (await t.app.inject({ method: 'GET', url: '/api/matches', headers: auth(a.token) })).json().matches;
    expect(list).toHaveLength(1);
    const rep = (await t.app.inject({ method: 'GET', url: `/api/replays/${sa.matchId}`, headers: auth(a.token) })).json().replay as ReplayData;
    expect(rep.actions.length).toBeGreaterThan(5);
    expect(replay(rep).result).toEqual(rep.result);

    // Un tiers ne peut pas voir ce replay.
    const other = await signup(t.app);
    expect((await t.app.inject({ method: 'GET', url: `/api/replays/${sa.matchId}`, headers: auth(other.token) })).statusCode).toBe(404);
  });

  it('action illégale ou hors tour : erreur, la partie continue', async () => {
    t = await startApp();
    const a = await player(t);
    a.client.send({ t: 'queue', deckId: a.deckId, mode: 'ghost' });
    await a.client.wait('match_start');
    await a.client.wait('step', (m) => !!m.view.legal);
    a.client.act({ type: 'play', uid: 'inexistant' });
    const error = await a.client.wait('error');
    expect(['illegal_action', 'not_your_decision']).toContain(error.code);
    a.client.send({ t: 'action', action: { type: 'nimporte' } as never });
    expect((await a.client.wait('error', (e) => e.code === 'invalid_message')).code).toBe('invalid_message');
  });

  it('fantôme après le délai d’attente : deck enregistré d’un autre joueur, joué par l’IA', async () => {
    t = await startApp({ ghostDelayMs: 50 });
    await signup(t.app, 'proprio'); // un autre joueur avec des decks enregistrés
    const a = await player(t);
    a.client.send({ t: 'queue', deckId: a.deckId, mode: 'ranked' });
    const start = await a.client.wait('match_start');
    expect(start.opponent.ghost).toBe(true);
    expect(start.opponent.name).toBe('proprio');
    await autoPlay(a.client);
    const end = await a.client.wait('match_end');
    expect(['life', 'deck_out', 'turn_limit', 'draw']).toContain(end.result.reason);
  });

  it('minuteurs serveur : sans réponse, les actions par défaut font avancer la partie', async () => {
    t = await startApp({ turnTimerMs: 30, reactionTimerMs: 30 });
    const a = await player(t);
    a.client.send({ t: 'queue', deckId: a.deckId, mode: 'ghost' });
    const step = await a.client.wait('step', (m) => m.deadline !== null);
    expect(step.deadline).toBeGreaterThan(Date.now() - 1000);
    await a.client.wait('match_end', () => true, 20_000);
  });

  it('reconnexion : la partie en cours est renvoyée', async () => {
    t = await startApp();
    const a = await player(t);
    a.client.send({ t: 'queue', deckId: a.deckId, mode: 'ghost' });
    const start = await a.client.wait('match_start');
    a.client.close();
    const again = await TestClient.connect(t.url, a.token);
    clients.push(again);
    const resumed = await again.wait('match_start');
    expect(resumed.matchId).toBe(start.matchId);
    const step = await again.wait('step');
    expect(step.view.me.hand.length).toBeGreaterThan(0);
  });

  it('deck inconnu ou partie déjà en cours : refusé', async () => {
    t = await startApp();
    const a = await player(t);
    a.client.send({ t: 'queue', deckId: '00000000-0000-4000-8000-000000000000', mode: 'casual' });
    expect((await a.client.wait('error')).code).toBe('deck_not_found');
    a.client.send({ t: 'queue', deckId: a.deckId, mode: 'ghost' });
    await a.client.wait('match_start');
    a.client.send({ t: 'queue', deckId: a.deckId, mode: 'casual' });
    expect((await a.client.wait('error', (e) => e.code === 'already_in_match')).code).toBe('already_in_match');
  });
});
