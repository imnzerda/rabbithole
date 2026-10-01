import { CATEGORIES, cardBudget, cardText, createContext, DEFAULT_RULES, referencePower, validateCardDef, type CardDef, type CategoryId, type MatchContext } from '@rabbithole/engine';
import type { Db } from '../db/db.js';

/**
 * Outil d'administration (section 12) : candidats du pipeline, cartes, séries, publication.
 * Toute modification est journalisée (`admin_audit`). La publication passe par la politique
 * de contenu (section 5) et exige une image créditée ou la carte typographique.
 */

export class AdminError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    readonly details: unknown = undefined,
  ) {
    super(code);
  }
}

export async function audit(db: Db, adminId: string, action: string, target: string | null, payload: unknown = {}): Promise<void> {
  await db.query('INSERT INTO admin_audit (admin_id, action, target, payload) VALUES ($1, $2, $3, $4)', [adminId, action, target, JSON.stringify(payload)]);
}

// ---------------------------------------------------------------------------
// Candidats (pipeline)
// ---------------------------------------------------------------------------

/** Sous-ensemble du candidat du pipeline (`tools/pipeline/src/types.ts`) utilisé ici. */
export interface PipelineCandidate {
  qid: string;
  kind: string;
  categories: CategoryId[];
  labels: Record<string, string>;
  descriptions: Record<string, string>;
  countries: string[];
  sitelinks: number;
  birth?: string | null;
  start?: string | null;
  views?: { last12Months: number };
  score?: { total: number; iconic: boolean; meetsThreshold: boolean };
  policy?: { status: 'ok' | 'needs_review' | 'excluded'; reasons: string[] };
  flags?: { adult?: boolean; sensitive?: boolean; politicallySensitive?: boolean };
  imageInfo?: {
    file: string;
    filePage: string;
    url: string;
    thumbUrl: string | null;
    author: string;
    license: string;
    licenseUrl: string | null;
    accepted: boolean;
    personalityRights: boolean;
  } | null;
}

export interface PipelineRun {
  series: string;
  candidates: PipelineCandidate[];
}

const QID = /^Q\d+$/;

/** Importe (ou met à jour) les candidats d'un fichier du pipeline ; la décision déjà prise est conservée. */
export async function importCandidates(db: Db, run: PipelineRun): Promise<{ imported: number; updated: number }> {
  let imported = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    for (const c of run.candidates) {
      if (!QID.test(c.qid)) throw new AdminError('invalid_candidate', 400, c.qid);
      const rows = await tx.query<{ inserted: boolean }>(
        `INSERT INTO candidates (qid, run_series, data, primary_category, policy_status, score)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (qid) DO UPDATE SET run_series = EXCLUDED.run_series, data = EXCLUDED.data,
           primary_category = EXCLUDED.primary_category, policy_status = EXCLUDED.policy_status,
           score = EXCLUDED.score, updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [c.qid, run.series, JSON.stringify(c), c.categories[0] ?? null, c.policy?.status ?? null, c.score?.total ?? null],
      );
      if (rows[0]?.inserted) imported++;
      else updated++;
    }
  });
  return { imported, updated };
}

export interface CandidateFilter {
  category?: string;
  status?: string;
  policy?: string;
  q?: string;
  minScore?: number;
  limit: number;
  offset: number;
}

export async function listCandidates(db: Db, f: CandidateFilter) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.category) add('primary_category = ?', f.category);
  if (f.status) add('status = ?', f.status);
  if (f.policy) add('policy_status = ?', f.policy);
  if (f.minScore !== undefined) add('score >= ?', f.minScore);
  if (f.q) {
    params.push(`%${f.q}%`, f.q.trim().toUpperCase());
    const like = `$${params.length - 1}`;
    where.push(`(data->'labels'->>'fr' ILIKE ${like} OR data->'labels'->>'en' ILIKE ${like} OR qid = $${params.length})`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [count] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM candidates ${clause}`, params);
  const rows = await db.query<{ qid: string; status: string; card_id: string | null; data: PipelineCandidate }>(
    `SELECT qid, status, card_id, data FROM candidates ${clause} ORDER BY score DESC NULLS LAST, qid LIMIT ${f.limit} OFFSET ${f.offset}`,
    params,
  );
  return {
    total: count?.n ?? 0,
    candidates: rows.map((r) => ({
      qid: r.qid,
      status: r.status,
      cardId: r.card_id,
      name: r.data.labels.fr ?? r.data.labels.en ?? r.qid,
      description: r.data.descriptions.fr ?? r.data.descriptions.en ?? '',
      kind: r.data.kind,
      categories: r.data.categories,
      countries: r.data.countries,
      sitelinks: r.data.sitelinks,
      views12: r.data.views?.last12Months ?? null,
      score: r.data.score ?? null,
      policy: r.data.policy ?? null,
      flags: r.data.flags ?? {},
      image: r.data.imageInfo ? { thumb: r.data.imageInfo.thumbUrl, license: r.data.imageInfo.license, accepted: r.data.imageInfo.accepted, author: r.data.imageInfo.author } : null,
    })),
  };
}

export async function setCandidateStatus(db: Db, qid: string, status: 'new' | 'shortlisted' | 'rejected'): Promise<void> {
  const done = await db.query("UPDATE candidates SET status = $2, updated_at = now() WHERE qid = $1 AND status <> 'carded' RETURNING qid", [qid, status]);
  if (!done.length) throw new AdminError('not_found', 404);
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);

async function freeCardId(db: Db, base: string): Promise<string> {
  for (let i = 1; ; i++) {
    const id = i === 1 ? base : `${base}_${i}`;
    const [taken] = await db.query('SELECT 1 FROM cards WHERE id = $1', [id]);
    if (!taken) return id;
  }
}

/**
 * Brouillon de carte à partir d'un candidat : nom, catégories, pays, drapeaux, image créditée.
 * Les stats de départ suivent le budget de référence (coût 3) ; l'éditeur les ajuste.
 */
export async function cardFromCandidate(db: Db, qid: string, seriesId: string, type: CardDef['type']): Promise<CardDef> {
  const [row] = await db.query<{ data: PipelineCandidate; status: string; card_id: string | null }>('SELECT data, status, card_id FROM candidates WHERE qid = $1', [qid]);
  if (!row) throw new AdminError('not_found', 404);
  const c = row.data;
  if (c.policy?.status === 'excluded') throw new AdminError('policy_excluded', 409, c.policy.reasons);
  const [series] = await db.query('SELECT 1 FROM series WHERE id = $1', [seriesId]);
  if (!series) throw new AdminError('unknown_series', 404);

  const name: Record<string, string> = {};
  for (const lang of ['fr', 'en', 'es', 'pt', 'de']) if (c.labels[lang]) name[lang] = c.labels[lang]!;
  const id = await freeCardId(db, `${seriesId}_${slug(c.labels.en ?? c.labels.fr ?? c.qid) || c.qid.toLowerCase()}`);
  const categories = (c.categories.length ? c.categories : (['internet'] as CategoryId[])).filter((x) => CATEGORIES.includes(x)).slice(0, 2);
  const cost = type === 'leader' ? 0 : 3;
  const accepted = !!c.imageInfo?.accepted;
  const def: CardDef = {
    id,
    wikidataId: c.qid,
    type,
    name,
    categories,
    cost,
    power: type === 'event' ? 0 : type === 'leader' ? 5 : referencePower(cost),
    ...(type === 'character' ? { counter: 1 } : {}),
    ...(type === 'leader' ? { life: 4 } : {}),
    rarity: c.score?.iconic ? 'iconique' : 'basique',
    series: seriesId,
    ...(c.countries.length === 1 ? { country: c.countries[0] } : {}),
    keywords: [],
    effects: type === 'event' ? [{ trigger: 'main', action: { type: 'draw', amount: 1 } }] : [],
    flavor: {},
    flags: { adult: !!c.flags?.adult, politicallySensitive: !!c.flags?.politicallySensitive, sensitive: !!c.flags?.sensitive },
    image: { assetId: null, fallback: !accepted },
  };

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO cards (id, series_id, wikidata_id, status, def, policy_status, policy_reasons) VALUES ($1, $2, $3, 'draft', $4, $5, $6)`,
      [id, seriesId, c.qid, JSON.stringify(def), c.policy?.status ?? 'needs_review', c.policy?.reasons ?? ['no_policy_check']],
    );
    if (accepted && c.imageInfo) {
      const img = c.imageInfo;
      await tx.query(
        `INSERT INTO card_images (card_id, source_url, file_page, author, license, license_url, personality_warning) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, img.thumbUrl ?? img.url, img.filePage, img.author, img.license, img.licenseUrl, img.personalityRights],
      );
    }
    await tx.query("UPDATE candidates SET status = 'carded', card_id = $2, updated_at = now() WHERE qid = $1", [qid, id]);
  });
  return def;
}

// ---------------------------------------------------------------------------
// Cartes
// ---------------------------------------------------------------------------

export type CardStatus = 'draft' | 'review' | 'published' | 'retired';

interface CardRow {
  id: string;
  series_id: string;
  wikidata_id: string | null;
  status: CardStatus;
  def: CardDef;
  version: number;
  policy_status: 'ok' | 'needs_review' | 'excluded';
  policy_reasons: string[];
  policy_cleared_by: string | null;
  policy_note: string | null;
  updated_at: string | Date;
}

/** Contexte de validation : toutes les cartes non retirées (brouillons compris, pour les références entre cartes). */
export async function workingContext(db: Db): Promise<MatchContext> {
  const rows = await db.query<{ def: CardDef }>("SELECT def FROM cards WHERE status <> 'retired'");
  return createContext({ cards: rows.map((r) => r.def) });
}

/** Erreurs de la définition (moteur) et références vers des cartes inconnues. */
export function checkDef(def: CardDef, ctx: MatchContext): string[] {
  const errors = validateCardDef(def);
  const refs: string[] = [];
  const walk = (a: unknown) => {
    const action = a as { type?: string; cards?: string[]; options?: unknown[] };
    if (action?.type === 'add_card_to_hand') refs.push(...(action.cards ?? []));
    if (action?.type === 'random_of') action.options?.forEach(walk);
  };
  for (const e of def.effects ?? []) walk(e.action);
  for (const id of refs) if (!ctx.cards[id] && id !== def.id) errors.push(`carte référencée inconnue : ${id}`);
  return errors;
}

/** Ce que voit l'éditeur : erreurs, budget, texte de la carte. */
export function preview(def: CardDef, ctx: MatchContext) {
  let text: { keyword?: string; text: string }[] = [];
  try {
    text = cardText({ ...ctx, cards: { ...ctx.cards, [def.id]: def }, rules: ctx.rules ?? DEFAULT_RULES }, def, 'fr');
  } catch {
    text = [];
  }
  const errors = checkDef(def, ctx);
  return { errors, budget: errors.length ? null : cardBudget(def), text };
}

export async function listCards(db: Db, f: { series?: string; status?: string; q?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.series) where.push(`series_id = $${params.push(f.series)}`);
  if (f.status) where.push(`status = $${params.push(f.status)}`);
  if (f.q) where.push(`(id ILIKE $${params.push(`%${f.q}%`)} OR def->'name'->>'fr' ILIKE $${params.length} OR def->'name'->>'en' ILIKE $${params.length})`);
  const rows = await db.query<CardRow>(`SELECT * FROM cards ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY series_id, updated_at DESC LIMIT 500`, params);
  return rows.map((r) => {
    const budget = validateCardDef(r.def).length ? null : cardBudget(r.def);
    return {
      id: r.id,
      series: r.series_id,
      status: r.status,
      name: r.def.name.fr ?? r.def.name.en ?? r.id,
      type: r.def.type,
      rarity: r.def.rarity,
      categories: r.def.categories,
      cost: r.def.cost,
      power: r.def.power,
      policy: r.policy_status,
      policyCleared: !!r.policy_cleared_by,
      budget: budget ? { delta: budget.delta, verdict: budget.verdict } : null,
    };
  });
}

export async function getCard(db: Db, id: string, ctx: MatchContext) {
  const [row] = await db.query<CardRow>('SELECT * FROM cards WHERE id = $1', [id]);
  if (!row) throw new AdminError('not_found', 404);
  const images = await db.query('SELECT id, source_url, file_page, author, license, license_url, modified, personality_warning, active FROM card_images WHERE card_id = $1 ORDER BY created_at DESC', [id]);
  return {
    id: row.id,
    series: row.series_id,
    status: row.status,
    version: row.version,
    def: row.def,
    policy: { status: row.policy_status, reasons: row.policy_reasons, cleared: !!row.policy_cleared_by, note: row.policy_note },
    images,
    ...preview(row.def, ctx),
  };
}

export async function createBlankCard(db: Db, seriesId: string, type: CardDef['type'], name: string): Promise<CardDef> {
  const [series] = await db.query('SELECT 1 FROM series WHERE id = $1', [seriesId]);
  if (!series) throw new AdminError('unknown_series', 404);
  const id = await freeCardId(db, `${seriesId}_${slug(name) || 'carte'}`);
  const def: CardDef = {
    id,
    type,
    name: { fr: name },
    categories: ['internet'],
    cost: type === 'leader' ? 0 : 2,
    power: type === 'event' ? 0 : type === 'leader' ? 5 : referencePower(2),
    ...(type === 'character' ? { counter: 1 } : {}),
    ...(type === 'leader' ? { life: 4 } : {}),
    rarity: 'basique',
    series: seriesId,
    keywords: [],
    effects: type === 'event' ? [{ trigger: 'main', action: { type: 'draw', amount: 1 } }] : [],
    flavor: {},
    image: { assetId: null, fallback: true },
  };
  // Carte créée à la main (concept, mème…) : pas de vérification automatique, revue humaine obligatoire.
  await db.query(`INSERT INTO cards (id, series_id, status, def, policy_status, policy_reasons) VALUES ($1, $2, 'draft', $3, 'needs_review', '{manual}')`, [id, seriesId, JSON.stringify(def)]);
  return def;
}

/** Enregistre une définition : l'identifiant et la série ne changent pas. Une carte retirée n'est plus modifiable. */
export async function saveCard(db: Db, id: string, def: CardDef, ctx: MatchContext): Promise<{ status: CardStatus; version: number }> {
  const [row] = await db.query<CardRow>('SELECT * FROM cards WHERE id = $1', [id]);
  if (!row) throw new AdminError('not_found', 404);
  if (row.status === 'retired') throw new AdminError('card_retired', 409);
  const next: CardDef = { ...def, id: row.id, series: row.series_id, ...(row.wikidata_id ? { wikidataId: row.wikidata_id } : {}) };
  const errors = checkDef(next, ctx);
  if (errors.length) throw new AdminError('invalid_card', 400, errors);
  const [saved] = await db.query<{ version: number }>('UPDATE cards SET def = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING version', [id, JSON.stringify(next)]);
  return { status: row.status, version: saved!.version };
}

/** Validation humaine d'une carte « à revoir » (section 5) ; une carte exclue ne peut jamais être validée. */
export async function clearPolicy(db: Db, id: string, adminId: string, note: string): Promise<void> {
  const [row] = await db.query<CardRow>('SELECT * FROM cards WHERE id = $1', [id]);
  if (!row) throw new AdminError('not_found', 404);
  if (row.policy_status === 'excluded') throw new AdminError('policy_excluded', 409, row.policy_reasons);
  await db.query('UPDATE cards SET policy_cleared_by = $2, policy_note = $3, updated_at = now() WHERE id = $1', [id, adminId, note]);
}

const TRANSITIONS: Record<CardStatus, CardStatus[]> = {
  draft: ['review', 'retired'],
  review: ['draft', 'published', 'retired'],
  published: ['retired'],
  retired: ['draft'],
};

/** Conditions de publication : définition valide, politique de contenu passée, image créditée ou carte typographique. */
export async function publishBlockers(db: Db, row: CardRow, ctx: MatchContext): Promise<string[]> {
  const blockers = checkDef(row.def, ctx);
  if (row.policy_status === 'excluded') blockers.push('politique de contenu : sujet exclu');
  if (row.policy_status === 'needs_review' && !row.policy_cleared_by) blockers.push('politique de contenu : validation humaine requise');
  if (!row.def.image?.fallback) {
    const [img] = await db.query("SELECT 1 FROM card_images WHERE card_id = $1 AND active AND author <> '' AND license <> ''", [row.id]);
    if (!img) blockers.push('image : aucune image créditée (ou cocher la carte typographique)');
  }
  return blockers;
}

export async function setCardStatus(db: Db, id: string, status: CardStatus, ctx: MatchContext): Promise<void> {
  const [row] = await db.query<CardRow>('SELECT * FROM cards WHERE id = $1', [id]);
  if (!row) throw new AdminError('not_found', 404);
  if (!TRANSITIONS[row.status].includes(status)) throw new AdminError('invalid_transition', 409, { from: row.status, to: status });
  if (status === 'published') {
    const blockers = await publishBlockers(db, row, ctx);
    if (blockers.length) throw new AdminError('cannot_publish', 409, blockers);
  }
  await db.query('UPDATE cards SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
}

/** Image : retrait en un clic (section 12) ; la carte passe en typographique si plus aucune image active. */
export async function setImageActive(db: Db, cardId: string, imageId: string, active: boolean): Promise<void> {
  const done = await db.query('UPDATE card_images SET active = $3 WHERE id = $2 AND card_id = $1 RETURNING id', [cardId, imageId, active]);
  if (!done.length) throw new AdminError('not_found', 404);
  const [left] = await db.query('SELECT 1 FROM card_images WHERE card_id = $1 AND active', [cardId]);
  await db.query(`UPDATE cards SET def = jsonb_set(def, '{image}', $2::jsonb), updated_at = now() WHERE id = $1`, [cardId, JSON.stringify({ assetId: null, fallback: !left })]);
}

// ---------------------------------------------------------------------------
// Séries
// ---------------------------------------------------------------------------

export async function listSeries(db: Db) {
  return db.query<{ id: string; type: string; country: string | null; name: Record<string, string>; status: string; cards: number; published: number }>(
    `SELECT s.id, s.type, s.country, s.name, s.status,
       (SELECT count(*)::int FROM cards c WHERE c.series_id = s.id AND c.status <> 'retired') AS cards,
       (SELECT count(*)::int FROM cards c WHERE c.series_id = s.id AND c.status = 'published') AS published
     FROM series s ORDER BY s.created_at`,
  );
}

export async function createSeries(db: Db, s: { id: string; type: string; country: string | null; name: Record<string, string> }): Promise<void> {
  const [taken] = await db.query('SELECT 1 FROM series WHERE id = $1', [s.id]);
  if (taken) throw new AdminError('series_exists', 409);
  await db.query('INSERT INTO series (id, type, country, name) VALUES ($1, $2, $3, $4)', [s.id, s.type, s.country, JSON.stringify(s.name)]);
}

export async function setSeriesStatus(db: Db, id: string, status: 'draft' | 'review' | 'published'): Promise<void> {
  const done = await db.query('UPDATE series SET status = $2 WHERE id = $1 RETURNING id', [id, status]);
  if (!done.length) throw new AdminError('not_found', 404);
}
