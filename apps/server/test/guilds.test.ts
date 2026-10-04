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
