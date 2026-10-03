import { PROTOTYPE_DECKS } from '@rabbithole/content';
import { validateDeck, type LocalizedText, type MatchContext } from '@rabbithole/engine';
import type { Db } from '../db/db.js';

/**
 * Decks de référence : un ou plusieurs par série, préparés et équilibrés hors de l'outil
 * (`tools/pipeline/decks/<série>.json`, test d'équilibre par simulation), importés dans l'admin.
 * Ils servent à l'entraînement contre l'IA et de fantômes de repli.
 * Les decks du prototype restent en dernier recours.
 */

export interface ReferenceDeck {
  id: string;
  series: string;
  name: LocalizedText;
  description: LocalizedText;
  leader: string;
  /** 20 cartes (identifiants complets, exemplaires répétés). */
  cards: string[];
}

interface Row {
  id: string;
  series_id: string;
  name: LocalizedText;
  description: LocalizedText;
  leader_id: string;
  card_ids: string[];
}

/** Decks jouables avec le catalogue publié : séries publiées d'abord, puis decks du prototype. */
export async function referenceDecks(db: Db, ctx: MatchContext): Promise<ReferenceDeck[]> {
  const rows = await db.query<Row>(
    `SELECT d.* FROM series_decks d JOIN series s ON s.id = d.series_id
     WHERE s.status = 'published' ORDER BY s.created_at DESC, d.id`,
  );
  const fromSeries = rows.map((r) => ({ id: r.id, series: r.series_id, name: r.name, description: r.description, leader: r.leader_id, cards: r.card_ids }));
  const prototype = PROTOTYPE_DECKS.map((d) => ({ ...d, series: 'prototype' }));
  return [...fromSeries, ...prototype].filter((d) => validateDeck(ctx, d.leader, d.cards).length === 0);
}

export interface DeckImport {
  id: string;
  name: LocalizedText;
  description?: LocalizedText;
  leader: string;
  /** 10 cartes en 2 exemplaires (format `tools/pipeline/decks`) ou 20 identifiants. Préfixe de série facultatif. */
  cards: string[];
}

const full = (series: string, id: string) => (id.startsWith(`${series}_`) || id.startsWith('proto_') ? id : `${series}_${id}`);

/** Normalise un deck importé : identifiants complets, 10 cartes doublées si besoin. */
export function normalizeDeck(series: string, d: DeckImport): { leader: string; cards: string[] } {
  const cards = d.cards.map((c) => full(series, c));
  return { leader: full(series, d.leader), cards: cards.length * 2 === 20 ? cards.flatMap((c) => [c, c]) : cards };
}

/** Import (ou remplacement) des decks d'une série ; chaque deck est validé avec les cartes non retirées. */
export async function importReferenceDecks(
  db: Db,
  series: string,
  decks: DeckImport[],
  ctx: MatchContext,
): Promise<{ imported: string[]; invalid: { id: string; errors: string[] }[] }> {
  const imported: string[] = [];
  const invalid: { id: string; errors: string[] }[] = [];
  for (const d of decks) {
    const { leader, cards } = normalizeDeck(series, d);
    const errors = validateDeck(ctx, leader, cards);
    if (errors.length) {
      invalid.push({ id: d.id, errors });
      continue;
    }
    await db.query(
      `INSERT INTO series_decks (id, series_id, name, description, leader_id, card_ids) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET series_id = $2, name = $3, description = $4, leader_id = $5, card_ids = $6, updated_at = now()`,
      [d.id, series, JSON.stringify(d.name), JSON.stringify(d.description ?? {}), leader, cards],
    );
    imported.push(d.id);
  }
  return { imported, invalid };
}
