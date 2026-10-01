import { PROTOTYPE_CARDS } from '@rabbithole/content';
import type { CardDef } from '@rabbithole/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { startApp } from './helpers.js';

type Started = Awaited<ReturnType<typeof startApp>>;
let t: Started | null = null;
afterEach(async () => {
  if (t) await t.app.close();
  t = null;
});

const get = (url: string) => t!.app.inject({ method: 'GET', url });

const newCard = (id: string): CardDef => ({
  id,
  type: 'character',
  name: { fr: 'Carte de test', en: 'Test card' },
  categories: ['internet'],
  cost: 2,
  power: 3,
  counter: 1,
  rarity: 'basique',
  series: 'prototype',
  keywords: [],
  effects: [],
});

describe('catalogue en base', () => {
  it('premier démarrage : les cartes du prototype sont publiées (jetons hors collection)', async () => {
    t = await startApp();
    const cat = t.catalog.current;
    expect(Object.keys(cat.ctx.cards)).toHaveLength(PROTOTYPE_CARDS.length);
    expect(cat.leaders).toHaveLength(5);
    expect(cat.collectibles).toHaveLength(50);
    expect(cat.collectibles.some((c) => c.series === 'prototype_tokens')).toBe(false);
    expect(cat.version).toMatch(/^cat@[0-9a-f]{12}$/);
  });

  it('API : catalogue courant avec sa version ; versions passées ; version inconnue', async () => {
    t = await startApp();
    const current = (await get('/api/catalog')).json();
    expect(current.version).toBe(t.catalog.current.version);
    expect(current.cards).toHaveLength(PROTOTYPE_CARDS.length);
    expect((await get(`/api/catalog/${current.version}`)).json().cards).toHaveLength(PROTOTYPE_CARDS.length);
    expect((await get('/api/catalog/cat@000000000000')).statusCode).toBe(404);
    // Parties jouées avant le catalogue en base : contenu du prototype.
    expect((await get('/api/catalog/prototype@abcdef123456')).json().cards).toHaveLength(PROTOTYPE_CARDS.length);
  });

  it('seules les cartes publiées comptent ; une publication crée une nouvelle version, l’ancienne reste lisible', async () => {
    t = await startApp();
    const before = t.catalog.current.version;
    await t.db.query(`INSERT INTO cards (id, series_id, status, def) VALUES ('test_draft', 'prototype', 'draft', $1)`, [JSON.stringify(newCard('test_draft'))]);
    expect((await t.catalog.reload()).version).toBe(before);
    expect(t.catalog.current.ctx.cards.test_draft).toBeUndefined();

    await t.db.query(`UPDATE cards SET status = 'published' WHERE id = 'test_draft'`);
    const after = await t.catalog.reload();
    expect(after.version).not.toBe(before);
    expect(after.collectibles.map((c) => c.id)).toContain('test_draft');

    const old = (await get(`/api/catalog/${before}`)).json().cards as CardDef[];
    expect(old.map((c) => c.id)).not.toContain('test_draft');
    const fresh = (await get('/api/catalog')).json();
    expect(fresh.version).toBe(after.version);
  });

  it('une carte retirée disparaît du catalogue (boosters, decks, parties)', async () => {
    t = await startApp();
    const id = t.catalog.current.collectibles[0]!.id;
    await t.db.query(`UPDATE cards SET status = 'retired' WHERE id = $1`, [id]);
    const snap = await t.catalog.reload();
    expect(snap.ctx.cards[id]).toBeUndefined();
    expect(snap.collectibles.map((c) => c.id)).not.toContain(id);
  });
});
