import { createHash } from 'node:crypto';
import { PROTOTYPE_CARDS } from '@rabbithole/content';
import { createContext, type CardDef, type MatchContext } from '@rabbithole/engine';
import type { Db } from '../db/db.js';

/**
 * Catalogue qui fait foi : les cartes **publiées** (carte et série publiées), lues en base.
 * Chaque état publié a une version (empreinte des définitions et des règles), enregistrée avec
 * chaque partie et conservée dans `catalog_versions` pour rejouer les replays à l'identique.
 */
export interface CatalogSnapshot {
  version: string;
  ctx: MatchContext;
  /** Leaders publiés. */
  leaders: CardDef[];
  /** Cartes à collectionner publiées (hors Leaders et jetons). */
  collectibles: CardDef[];
}

/** Séries qui ne se collectionnent pas (jetons créés en cours de partie). */
const NOT_COLLECTIBLE = new Set(['tokens']);

export function snapshotOf(cards: CardDef[], seriesTypes: Map<string, string>): CatalogSnapshot {
  const sorted = [...cards].sort((a, b) => a.id.localeCompare(b.id));
  const ctx = createContext({ cards: sorted });
  const version = `cat@${createHash('sha256').update(JSON.stringify({ cards: sorted, rules: ctx.rules })).digest('hex').slice(0, 12)}`;
  const collectible = (c: CardDef) => !NOT_COLLECTIBLE.has(seriesTypes.get(c.series) ?? '');
  return {
    version,
    ctx,
    leaders: sorted.filter((c) => c.type === 'leader' && collectible(c)),
    collectibles: sorted.filter((c) => c.type !== 'leader' && collectible(c)),
  };
}

export class Catalog {
  private snap: CatalogSnapshot | null = null;

  private constructor(private readonly db: Db) {}

  /** Ouvre le catalogue ; au premier démarrage, la base reçoit les cartes du prototype. */
  static async open(db: Db): Promise<Catalog> {
    const catalog = new Catalog(db);
    await seedPrototype(db);
    await catalog.reload();
    return catalog;
  }

  get current(): CatalogSnapshot {
    if (!this.snap) throw new Error('Catalogue non chargé');
    return this.snap;
  }

  /** Relit les cartes publiées (après une publication dans l'outil d'admin). Les parties en cours gardent leur version. */
  async reload(): Promise<CatalogSnapshot> {
    const rows = await this.db.query<{ def: CardDef; series_type: string; series_id: string }>(
      `SELECT c.def, s.type AS series_type, s.id AS series_id FROM cards c JOIN series s ON s.id = c.series_id
       WHERE c.status = 'published' AND s.status = 'published'`,
    );
    const snap = snapshotOf(
      rows.map((r) => r.def),
      new Map(rows.map((r) => [r.series_id, r.series_type])),
    );
    await this.db.query('INSERT INTO catalog_versions (version, cards) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING', [
      snap.version,
      JSON.stringify(Object.values(snap.ctx.cards)),
    ]);
    this.snap = snap;
    return snap;
  }

  /** Cartes d'une version passée (replays). */
  async cardsOf(version: string): Promise<CardDef[] | null> {
    if (version === this.current.version) return Object.values(this.current.ctx.cards);
    const [row] = await this.db.query<{ cards: CardDef[] }>('SELECT cards FROM catalog_versions WHERE version = $1', [version]);
    if (row) return row.cards;
    // Parties jouées avant le catalogue en base (phase 3) : contenu du prototype.
    return version.startsWith('prototype@') ? PROTOTYPE_CARDS : null;
  }
}

/** Premier démarrage : les cartes fictives du prototype deviennent la série `prototype`, publiée. */
async function seedPrototype(db: Db): Promise<void> {
  const [done] = await db.query("SELECT 1 FROM series WHERE id = 'prototype'");
  if (done) return;
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO series (id, type, name, status) VALUES
         ('prototype', 'prototype', '{"fr":"Prototype","en":"Prototype"}', 'published'),
         ('prototype_tokens', 'tokens', '{"fr":"Jetons","en":"Tokens"}', 'published')`,
    );
    for (const def of PROTOTYPE_CARDS) {
      await tx.query(`INSERT INTO cards (id, series_id, wikidata_id, status, def) VALUES ($1, $2, $3, 'published', $4)`, [
        def.id,
        def.series,
        def.wikidataId ?? null,
        JSON.stringify(def),
      ]);
    }
  });
}
