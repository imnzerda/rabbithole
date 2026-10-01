import type { CardDef } from '@rabbithole/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { auth, signup, signupPayload, signupWithKit, startApp } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
afterEach(async () => {
  if (t) await t.app.close();
  t = null;
});

const ADMIN = 'modo@example.com';

async function setup() {
  t = await startApp({ adminEmails: [ADMIN] });
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload('modo', { email: ADMIN }) });
  const adminToken = res.cookies.find((c) => c.name === 'rh_session')!.value;
  const as = (token: string | null) => (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    t!.app.inject({ method, url, headers: token ? auth(token) : {}, payload: payload as object });
  return { admin: as(adminToken), as };
}

/** Marque une carte du prototype (drapeaux) et relit le catalogue. */
async function flag(id: string, flags: CardDef['flags']) {
  await t!.db.query(`UPDATE cards SET def = jsonb_set(def, '{flags}', $2::jsonb) WHERE id = $1`, [id, JSON.stringify(flags)]);
  await t!.catalog.reload();
}

describe('contenu sensible et règles par pays', () => {
  it('contenu sensible masqué par défaut ; l’interrupteur l’affiche (affichage seulement)', async () => {
    const { as } = await setup();
    const sensitive = t!.catalog.current.collectibles[3]!.id;
    await flag(sensitive, { sensitive: true });
    const player = await signup(t!.app, 'curieux');
    const call = as(player.token);

    let f = (await call('GET', '/api/content-filter')).json();
    expect(f).toMatchObject({ showSensitive: false, blocked: [] });
    expect(f.masked).toEqual([sensitive]);
    // Sans compte aussi.
    expect((await as(null)('GET', '/api/content-filter')).json().masked).toEqual([sensitive]);

    expect((await call('POST', '/api/me/settings', { showSensitive: true })).json()).toEqual({ showSensitive: true });
    f = (await call('GET', '/api/content-filter')).json();
    expect(f.masked).toEqual([]);
    expect((await call('GET', '/api/me')).json().user.showSensitive).toBe(true);
  });

  it('pays sans contenu adulte : carte bloquée (boosters, deck), affichée masquée', async () => {
    const { admin, as } = await setup();
    const adult = t!.catalog.current.collectibles.find((c) => c.type === 'character')!;
    await flag(adult.id, { adult: true });
    expect((await admin('PUT', '/api/admin/country-rules/FR', { allowAdult: false, allowPolitical: true, blockedCardIds: [] })).statusCode).toBe(200);

    const player = await signupWithKit(t!.app, 'francais');
    const call = as(player.token);
    const f = (await call('GET', '/api/content-filter')).json();
    expect(f.blocked).toEqual([adult.id]);
    expect(f.masked).toContain(adult.id);

    // Jamais dans un aperçu de booster.
    for (let i = 0; i < 15; i++) {
      await t!.db.query("UPDATE booster_previews SET refresh_at = now() - interval '1 minute' WHERE user_id = $1", [player.id]);
      const preview = (await call('GET', '/api/boosters')).json().types[0].preview.cardIds as string[];
      expect(preview).not.toContain(adult.id);
    }
    // Refusée dans un deck.
    const deck = (await call('GET', '/api/decks')).json().decks.find((d: { cardIds: string[] }) => d.cardIds.includes(adult.id));
    if (deck) {
      const res = await call('PUT', `/api/decks/${deck.id}`, { name: deck.name, leaderId: deck.leaderId, cardIds: deck.cardIds });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json().errors)).toContain('indisponible dans ton pays');
    }
    // Un joueur d'un autre pays n'est pas concerné.
    const other = await t!.app.inject({ method: 'POST', url: '/api/auth/signup', payload: signupPayload('belge', { country: 'BE' }) });
    const otherToken = other.cookies.find((c) => c.name === 'rh_session')!.value;
    expect((await as(otherToken)('GET', '/api/content-filter')).json().blocked).toEqual([]);
  });
});

describe('signalements', () => {
  it('signaler une carte ; la modération traite le signalement', async () => {
    const { admin, as } = await setup();
    const player = await signup(t!.app, 'vigilant');
    const card = t!.catalog.current.collectibles[0]!.id;
    expect((await as(player.token)('POST', '/api/reports', { target: { type: 'card', cardId: card }, reason: 'inaccurate', details: 'Date fausse.' })).statusCode).toBe(201);
    expect((await as(player.token)('POST', '/api/reports', { target: { type: 'card', cardId: 'inconnue' }, reason: 'other' })).statusCode).toBe(404);
    expect((await as(null)('POST', '/api/reports', { target: { type: 'card', cardId: card }, reason: 'other' })).statusCode).toBe(401);

    const open = (await admin('GET', '/api/admin/reports')).json().reports;
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ target_type: 'card', card_id: card, reason: 'inaccurate', reporter: 'vigilant', open_on_target: 1 });
    expect((await admin('POST', `/api/admin/reports/${open[0].id}`, { status: 'resolved', resolution: '' })).statusCode).toBe(400);
    await admin('POST', `/api/admin/reports/${open[0].id}`, { status: 'resolved', resolution: 'Date corrigée.' });
    expect((await admin('GET', '/api/admin/reports')).json().reports).toHaveLength(0);
    expect((await admin('GET', '/api/admin/overview')).json().counts.reports_open).toBe(0);
  });

  it('signaler un joueur : seulement l’adversaire d’une partie jouée', async () => {
    const { as } = await setup();
    const a = await signup(t!.app, 'alice');
    const b = await signup(t!.app, 'bruno');
    const outsider = await signup(t!.app, 'curieux');
    const [m] = await t!.db.query<{ id: string }>(
      `INSERT INTO matches (mode, player_a, player_b, players, seed, content_version) VALUES ('casual', $1, $2, '[]', 's', 'v') RETURNING id`,
      [a.id, b.id],
    );
    const report = { target: { type: 'player', matchId: m!.id }, reason: 'harassment' };
    expect((await as(a.token)('POST', '/api/reports', report)).statusCode).toBe(201);
    expect((await as(outsider.token)('POST', '/api/reports', report)).statusCode).toBe(404);
    const [row] = await t!.db.query<{ target_user_id: string }>('SELECT target_user_id FROM reports');
    expect(row!.target_user_id).toBe(b.id);
  });
});

describe('demandes de retrait et crédits', () => {
  it('formulaire public ; échéance à 72 h ; retrait de la carte en un clic', async () => {
    const { admin, as } = await setup();
    const card = t!.catalog.current.collectibles[1]!.id;
    const bad = await as(null)('POST', '/api/takedown', { cardId: card, name: 'X', contact: 'pas-un-email', relation: 'self', reason: 'court' });
    expect(bad.statusCode).toBe(400);
    const res = await as(null)('POST', '/api/takedown', { cardId: card, name: 'Jean Martin', contact: 'jean@example.com', relation: 'self', reason: 'Je ne souhaite pas apparaître dans ce jeu.' });
    expect(res.statusCode).toBe(201);
    const due = new Date(res.json().dueAt).getTime();
    expect(due - Date.now()).toBeGreaterThan(71 * 3600_000);

    const list = (await admin('GET', '/api/admin/takedowns')).json().takedowns;
    expect(list[0]).toMatchObject({ card_id: card, status: 'open', overdue: false });
    expect((await admin('GET', '/api/admin/overview')).json().counts.takedowns_open).toBe(1);
    await admin('POST', `/api/admin/takedowns/${list[0].id}`, { status: 'done', resolution: 'Carte retirée.', retireCard: true });
    expect(t!.catalog.current.ctx.cards[card]).toBeUndefined();
    const actions = (await admin('GET', '/api/admin/audit')).json().entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['card.retired', 'takedown.done']));
  });

  it('crédits : images actives des cartes jouables', async () => {
    const { as } = await setup();
    const card = t!.catalog.current.collectibles[2]!.id;
    await t!.db.query(
      `INSERT INTO card_images (card_id, source_url, file_page, author, license) VALUES ($1, 'https://upload.wikimedia.org/x.jpg', 'https://commons.wikimedia.org/wiki/File:X.jpg', 'Jane Doe', 'CC BY-SA 4.0')`,
      [card],
    );
    const credits = (await as(null)('GET', '/api/credits')).json().credits;
    expect(credits).toEqual([expect.objectContaining({ cardId: card, author: 'Jane Doe', license: 'CC BY-SA 4.0', modified: true })]);
  });
});
