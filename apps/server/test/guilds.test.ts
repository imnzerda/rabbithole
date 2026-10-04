import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_GUILDS } from '../src/config.js';
import { auth, signup, startApp } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
afterEach(async () => {
  if (t) await t.app.close();
  t = null;
});

const get = (url: string, token: string) => t!.app.inject({ method: 'GET', url, headers: auth(token) });
const post = (url: string, token: string, payload: object = {}) => t!.app.inject({ method: 'POST', url, headers: auth(token), payload });
const settings = { description: 'On creuse ensemble.', emblem: 'internet', language: 'fr', open: true };

async function richPlayer(name: string) {
  const p = await signup(t!.app, name);
  await t!.db.query('UPDATE wallets SET coins = 1000 WHERE user_id = $1', [p.id]);
  return p;
}

describe('guildes', () => {
  it('création payante, nom unique sans tenir compte de la casse, une guilde par joueur, recherche', async () => {
    t = await startApp();
    const chef = await richPlayer('chef');
    const res = await post('/api/guilds', chef.token, { name: 'Les  Terriers', ...settings });
    expect(res.statusCode).toBe(200);
    const mine = res.json();
    expect(mine.guild).toMatchObject({ name: 'Les Terriers', emblem: 'internet', level: 1, members: 1, capacity: DEFAULT_GUILDS.capacity.base, you: 'leader' });
    expect((await get('/api/wallet', chef.token)).json().wallet.coins).toBe(1000 - DEFAULT_GUILDS.creationCoins);
    expect((await post('/api/guilds', chef.token, { name: 'Autre', ...settings })).json().error).toBe('already_in_guild');

    const other = await richPlayer('autre');
    expect((await post('/api/guilds', other.token, { name: 'les terriers', ...settings })).json().error).toBe('guild_name_taken');
    expect((await post('/api/guilds', other.token, { name: 'Ok', ...settings })).statusCode).toBe(400); // trop court
    expect((await post('/api/guilds', other.token, { name: 'Emblème faux', ...settings, emblem: 'pizza' })).json().error).toBe('invalid_emblem');
    const poor = await signup(t.app, 'pauvre');
    expect((await post('/api/guilds', poor.token, { name: 'Fauchés', ...settings })).json().error).toBe('not_enough_coins');

    const found = (await get('/api/guilds?q=TERR', other.token)).json().guilds;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'Les Terriers', members: 1, open: true });
    expect((await get('/api/guilds?lang=en', other.token)).json().guilds).toHaveLength(0);
  });

  it('entrée libre ou sur demande, rôles, exclusion, succession du chef, dissolution', async () => {
    t = await startApp();
    const chef = await richPlayer('chef');
    const guildId = (await post('/api/guilds', chef.token, { name: 'Club Fermé', ...settings, open: false })).json().guild.id as string;
    const a = await signup(t.app, 'alice');
    const b = await signup(t.app, 'bruno');

    // Guilde fermée : demande, acceptée par le chef (notification).
    expect((await post(`/api/guilds/${guildId}/join`, a.token)).json()).toMatchObject({ status: 'requested', pending: [guildId], guild: null });
    expect((await post(`/api/guilds/${guildId}/join`, b.token)).json().status).toBe('requested');
    expect((await post(`/api/guilds/requests/${a.id}`, b.token, { accept: true })).json().error).toBe('forbidden');
    const afterAccept = (await post(`/api/guilds/requests/${a.id}`, chef.token, { accept: true })).json();
    expect(afterAccept.guild.members).toBe(2);
    expect(afterAccept.guild.requests.map((r: { name: string }) => r.name)).toEqual(['bruno']);
    expect((await get('/api/notices', a.token)).json().notices[0]).toMatchObject({ kind: 'guild_joined', payload: { guild: 'Club Fermé' } });

    // Adjoint : accepte les demandes, ne peut exclure qu'un simple membre.
    await post(`/api/guilds/members/${a.id}/role`, chef.token, { role: 'officer' });
    await post(`/api/guilds/requests/${b.id}`, a.token, { accept: true });
    expect((await post(`/api/guilds/members/${chef.id}/kick`, a.token)).json().error).toBe('forbidden');
    expect((await post(`/api/guilds/members/${b.id}/role`, a.token, { role: 'officer' })).json().error).toBe('forbidden');
    const kicked = (await post(`/api/guilds/members/${b.id}/kick`, a.token)).json();
    expect(kicked.guild.roster.map((m: { name: string; role: string }) => `${m.name}:${m.role}`)).toEqual(['chef:leader', 'alice:officer']);
    expect((await get('/api/notices', b.token)).json().notices[0].kind).toBe('guild_kicked');

    // Le chef part : l'adjoint le plus ancien prend la tête ; le dernier qui part dissout la guilde.
    await post('/api/guilds/leave', chef.token);
    const led = (await get('/api/guilds/me', a.token)).json();
    expect(led.guild).toMatchObject({ you: 'leader', members: 1 });
    await post('/api/guilds/leave', a.token);
    expect((await get(`/api/guilds/${guildId}`, a.token)).statusCode).toBe(404);
  });

  it('passer la main, réglages réservés au chef, guilde pleine', async () => {
    t = await startApp({ guilds: { ...DEFAULT_GUILDS, capacity: { base: 2, boosted: 3, boostLevel: 10 } } });
    const chef = await richPlayer('chef');
    const guildId = (await post('/api/guilds', chef.token, { name: 'Petite', ...settings })).json().guild.id as string;
    const a = await signup(t.app, 'alice');
    const b = await signup(t.app, 'bruno');
    expect((await post(`/api/guilds/${guildId}/join`, a.token)).json().status).toBe('joined');
    expect((await post(`/api/guilds/${guildId}/join`, b.token)).json().error).toBe('guild_full');

    expect((await post('/api/guilds/settings', a.token, { ...settings, open: false })).json().error).toBe('forbidden');
    const transferred = (await post(`/api/guilds/members/${a.id}/role`, chef.token, { role: 'leader' })).json();
    expect(transferred.guild.you).toBe('officer');
    const updated = (await post('/api/guilds/settings', a.token, { ...settings, emblem: 'science', open: false })).json();
    expect(updated.guild).toMatchObject({ emblem: 'science', open: false, you: 'leader' });
  });
});

describe('vie de guilde', () => {
  it('niveaux : coût croissant, bonus de pièces et capacité', async () => {
    const { levelFor, coinBonusFor } = await import('../src/guilds/guilds.js');
    const c = DEFAULT_GUILDS;
    expect(levelFor(0, c)).toEqual({ level: 1, levelXp: 0, nextXp: c.xpPerLevel });
    expect(levelFor(c.xpPerLevel, c)).toEqual({ level: 2, levelXp: c.xpPerLevel, nextXp: c.xpPerLevel * 3 });
    expect(levelFor(1e9, c)).toMatchObject({ level: c.maxLevel, nextXp: null });
    expect([1, 3, 6, 7, 20].map((l) => coinBonusFor(l, c))).toEqual([0, 5, 5, 10, 15]);
  });

  it('XP de guilde plafonnée par membre et par jour, montée de niveau', async () => {
    t = await startApp();
    const { addGuildXp, guildCoinBonus } = await import('../src/guilds/guilds.js');
    const chef = await richPlayer('chef');
    await post('/api/guilds', chef.token, { name: 'Montée', ...settings });
    const day = new Date('2026-10-05T10:00:00Z');
    expect(await addGuildXp(t.db, chef.id, 150, DEFAULT_GUILDS, day)).toBe(150);
    expect(await addGuildXp(t.db, chef.id, 150, DEFAULT_GUILDS, day)).toBe(DEFAULT_GUILDS.xp.dailyCapPerMember - 150);
    expect(await addGuildXp(t.db, chef.id, 10, DEFAULT_GUILDS, day)).toBe(0);
    // Le lendemain, le plafond repart à zéro.
    for (let d = 6; d <= 12; d++) await addGuildXp(t.db, chef.id, 200, DEFAULT_GUILDS, new Date(`2026-10-${String(d).padStart(2, '0')}T10:00:00Z`));
    const g = (await get('/api/guilds/me', chef.token)).json().guild;
    expect(g.progress.xp).toBe(1600);
    expect(g.level).toBe(4); // 250 + 500 + 750 = 1500 ≤ 1600 < 2500
    expect(g.progress).toMatchObject({ levelXp: 1500, nextXp: 2500, coinBonus: 5 });
    expect(g.roster[0].xp).toBe(1600);
    expect(await guildCoinBonus(t.db, chef.id, DEFAULT_GUILDS)).toBe(5);
  });

  it('demandes de cartes et dons : rareté, délai, récompense, carte retirée des decks, échanges entre membres, tableau', async () => {
    t = await startApp();
    const chef = await richPlayer('chef');
    const guildId = (await post('/api/guilds', chef.token, { name: 'Entraide', ...settings })).json().guild.id as string;
    const a = await signup(t.app, 'alice');
    await post(`/api/guilds/${guildId}/join`, a.token);
    const cards = t.catalog.current.collectibles;
    const basic = cards.find((c) => c.rarity === 'basique')!;
    const goat = cards.find((c) => c.rarity === 'goat');

    if (goat) expect((await post('/api/guilds/card-requests', a.token, { cardId: goat.id })).json().error).toBe('not_requestable');
    const asked = (await post('/api/guilds/card-requests', a.token, { cardId: basic.id })).json().guild;
    expect(asked.cardRequests[0]).toMatchObject({ cardId: basic.id, wanted: DEFAULT_GUILDS.requests.maxByRarity.basique, received: 0, you: true });
    expect(asked.nextRequestAt).not.toBeNull();
    expect((await post('/api/guilds/card-requests', a.token, { cardId: basic.id })).json().error).toBe('request_cooldown');

    // Le chef donne : il en possède 2, dont un dans un deck.
    await t.db.query('INSERT INTO collections (user_id, card_id, quantity) VALUES ($1, $2, 2)', [chef.id, basic.id]);
    await t.db.query("INSERT INTO decks (user_id, name, leader_id, card_ids) VALUES ($1, 'Deck', $2, $3)", [chef.id, t.catalog.current.leaders[0]!.id, [basic.id, basic.id]]);
    const requestId = asked.cardRequests[0].id as string;
    expect((await post(`/api/guilds/card-requests/${requestId}/donate`, a.token)).json().error).toBe('self');
    const coinsBefore = (await get('/api/wallet', chef.token)).json().wallet.coins;
    const donated = (await post(`/api/guilds/card-requests/${requestId}/donate`, chef.token)).json();
    expect(donated.reward).toEqual({ coins: DEFAULT_GUILDS.requests.donorCoins.basique, tokens: DEFAULT_GUILDS.requests.donorTokens.basique });
    expect(donated.guild.tokens).toBe(DEFAULT_GUILDS.requests.donorTokens.basique);
    expect(donated.guild.cardRequests[0]).toMatchObject({ received: 1, owned: 1 });
    expect(donated.guild.progress.xp).toBe(DEFAULT_GUILDS.xp.donation);
    expect((await get('/api/wallet', chef.token)).json().wallet.coins).toBe(coinsBefore + DEFAULT_GUILDS.requests.donorCoins.basique);
    const [aliceCard] = await t.db.query<{ quantity: number }>('SELECT quantity FROM collections WHERE user_id = $1 AND card_id = $2', [a.id, basic.id]);
    expect(aliceCard!.quantity).toBe(1);
    const [deck] = await t.db.query<{ card_ids: string[] }>('SELECT card_ids FROM decks WHERE user_id = $1', [chef.id]);
    expect(deck!.card_ids).toEqual([basic.id]);
    await post(`/api/guilds/card-requests/${requestId}/donate`, chef.token);
    expect((await post(`/api/guilds/card-requests/${requestId}/donate`, chef.token)).json().error).toBe('not_owned');

    // Échange entre membres sans être amis.
    const trade = await post('/api/trades', chef.token, { toUserId: a.id, offered: [], requested: [{ cardId: basic.id, quantity: 1 }] });
    expect(trade.statusCode).toBe(200);

    // Tableau : 5 annonces au plus ; un membre ne retire que les siennes, le chef toutes.
    for (let i = 0; i < DEFAULT_GUILDS.maxBoardPosts; i++) await post('/api/guilds/board', a.token, { kind: i % 2 ? 'seek' : 'offer', cardId: basic.id });
    expect((await post('/api/guilds/board', a.token, { kind: 'seek', cardId: basic.id })).json().error).toBe('board_full');
    const chefPost = (await post('/api/guilds/board', chef.token, { kind: 'seek', cardId: basic.id })).json().guild.board[0];
    expect((await post(`/api/guilds/board/${chefPost.id}/remove`, a.token)).json().error).toBe('forbidden');
    const board = (await get('/api/guilds/me', chef.token)).json().guild.board as { id: string; you: boolean }[];
    expect((await post(`/api/guilds/board/${board.find((p) => !p.you)!.id}/remove`, chef.token)).json().guild.board).toHaveLength(5);

    // Départ : annonces et demande d'Alice disparaissent.
    await post('/api/guilds/leave', a.token);
    const after = (await get('/api/guilds/me', chef.token)).json().guild;
    expect(after.board.every((p: { you: boolean }) => p.you)).toBe(true);
    expect(after.cardRequests).toHaveLength(0);
  });
});
