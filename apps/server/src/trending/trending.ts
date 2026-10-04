import type { TrendingCardDto } from '@rabbithole/shared';
import type { CatalogSnapshot } from '../catalog/catalog.js';
import type { TrendingConfig } from '../config.js';
import type { Db } from '../db/db.js';

/**
 * Tendance du jour (section 8). Chaque jour à l'heure de calcul (UTC) : vues Wikipédia de la veille de chaque
 * carte (langues suivies additionnées), comparées à la moyenne des 30 jours précédents. Les meilleures cartes
 * au-dessus d'un minimum de vues sont retenues ; la liste de surveillance et les décès récents sont exclus
 * d'office. Après une fenêtre où l'admin peut écarter une carte, la liste est publiée et le bonus Tendance
 * (+1 puissance) vaut pour les parties en ligne pendant 24 h.
 */

/** Vues quotidiennes par titre, de la plus ancienne à la plus récente (la dernière = la veille). */
export type ViewsSource = (lang: string, titles: string[]) => Promise<Map<string, number[]>>;

const USER_AGENT = 'RabbitHoleServer/0.1 (https://github.com/imnzerda/rabbithole)';

interface PageviewsResponse {
  query?: { pages?: { title: string; pageviews?: Record<string, number | null> }[]; normalized?: { from: string; to: string }[] };
  continue?: Record<string, string>;
}

/** Source réelle : API MediaWiki (extension PageViewInfo), 31 jours, par lots de 50 titres. */
export const wikimediaSource: ViewsSource = async (lang, titles) => {
  const out = new Map<string, number[]>();
  const unique = [...new Set(titles)];
  for (let i = 0; i < unique.length; i += 50) {
    const part = unique.slice(i, i + 50);
    const normalized = new Map<string, string>();
    const byTitle = new Map<string, number[]>();
    let cont: Record<string, string> = {};
    for (let page = 0; page < 50; page++) {
      const params = new URLSearchParams({ action: 'query', prop: 'pageviews', pvipdays: '31', titles: part.join('|'), format: 'json', formatversion: '2', maxlag: '5', ...cont });
      const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, { headers: { 'user-agent': USER_AGENT } });
      if (!res.ok) throw new Error(`Wikimedia ${lang} : HTTP ${res.status}`);
      const json = (await res.json()) as PageviewsResponse;
      for (const n of json.query?.normalized ?? []) normalized.set(n.from, n.to);
      for (const p of json.query?.pages ?? []) {
        if (!p.pageviews) continue;
        const days = Object.keys(p.pageviews).sort();
        byTitle.set(p.title, days.map((d) => p.pageviews![d] ?? 0));
      }
      await new Promise((r) => setTimeout(r, 300));
      if (!json.continue) break;
      cont = json.continue;
    }
    for (const t of part) out.set(t, byTitle.get(normalized.get(t) ?? t) ?? []);
  }
  return out;
};

export const dateKey = (d: Date) => d.toISOString().slice(0, 10);

/** Additionne des séries quotidiennes alignées sur la date la plus récente. */
function addSeries(a: number[], b: number[]): number[] {
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => (a[a.length - n + i] ?? 0) + (b[b.length - n + i] ?? 0));
}

/** Calcul du jour : scores, exclusions, et liste des cartes retenues (pas encore publiée). */
export async function computeTrending(db: Db, config: TrendingConfig, catalog: CatalogSnapshot, source: ViewsSource, now = new Date()): Promise<void> {
  const date = dateKey(now);
  const cards = [...catalog.collectibles, ...catalog.leaders].filter((c) => c.wikidataId);
  const rows = await db.query<{ qid: string; wikis: Record<string, string> | null; death: string | null }>(
    "SELECT qid, data->'wikis' AS wikis, data->>'death' AS death FROM candidates WHERE qid = ANY($1::text[])",
    [cards.map((c) => c.wikidataId!)],
  );
  const byQid = new Map(rows.map((r) => [r.qid, r]));

  const series = new Map<string, number[]>();
  for (const lang of config.languages) {
    const titles = new Map<string, string>();
    for (const c of cards) {
      const title = byQid.get(c.wikidataId!)?.wikis?.[lang];
      if (title) titles.set(c.id, title);
    }
    const views = await source(lang, [...titles.values()]);
    for (const [cardId, title] of titles) series.set(cardId, addSeries(series.get(cardId) ?? [], views.get(title) ?? []));
  }

  const watchlist = new Set((await db.query<{ card_id: string }>('SELECT card_id FROM trending_watchlist')).map((r) => r.card_id));
  const deathLimit = now.getTime() - config.recentDeathDays * 86_400_000;
  const scored = cards
    .map((c) => {
      const s = series.get(c.id) ?? [];
      const yesterday = s.at(-1) ?? 0;
      const before = s.slice(-31, -1);
      const average = before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0;
      return { card: c, yesterday, average, score: yesterday / Math.max(average, 1) };
    })
    .filter((x) => x.yesterday >= config.minViews)
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));

  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM trending WHERE date = $1', [date]);
    let kept = 0;
    for (const x of scored) {
      if (kept >= config.count) break;
      const death = byQid.get(x.card.wikidataId!)?.death;
      const reason = watchlist.has(x.card.id) ? 'watchlist' : death && Date.parse(death) >= deathLimit ? 'recent_death' : null;
      if (!reason) kept++;
      await tx.query('INSERT INTO trending (date, card_id, score, views, average, excluded_reason) VALUES ($1, $2, $3, $4, $5, $6)', [
        date,
        x.card.id,
        x.score,
        x.yesterday,
        x.average,
        reason,
      ]);
    }
    await tx.query('INSERT INTO trending_runs (date) VALUES ($1) ON CONFLICT (date) DO UPDATE SET computed_at = now(), published_at = NULL', [date]);
  });
}

export async function publishTrending(db: Db, date: string): Promise<void> {
  await db.query('UPDATE trending_runs SET published_at = now() WHERE date = $1 AND published_at IS NULL', [date]);
}

/** Dernière liste publiée depuis moins de 24 h. */
async function activeRun(db: Db, now: Date): Promise<string | null> {
  const [run] = await db.query<{ date: string }>(
    "SELECT date FROM trending_runs WHERE published_at IS NOT NULL AND published_at <= $1 AND published_at > $1::timestamptz - interval '24 hours' ORDER BY date DESC LIMIT 1",
    [now.toISOString()],
  );
  return run?.date ?? null;
}

/** Cartes qui ont le bonus Tendance en ce moment (parties en ligne). */
export async function activeTrending(db: Db, now = new Date()): Promise<string[]> {
  const date = await activeRun(db, now);
  if (!date) return [];
  const rows = await db.query<{ card_id: string }>('SELECT card_id FROM trending WHERE date = $1 AND excluded_reason IS NULL ORDER BY score DESC', [date]);
  return rows.map((r) => r.card_id);
}

/** Liste d'un jour, exclusions comprises (admin), ou publiée seulement (joueurs). */
export async function trendingOf(db: Db, date: string, includeExcluded: boolean): Promise<TrendingCardDto[]> {
  const rows = await db.query<{ card_id: string; score: number; views: number; average: number; excluded_reason: string | null }>(
    `SELECT card_id, score, views, average, excluded_reason FROM trending WHERE date = $1 ${includeExcluded ? '' : 'AND excluded_reason IS NULL'} ORDER BY score DESC`,
    [date],
  );
  return rows.map((r) => ({ cardId: r.card_id, score: Math.round(r.score * 10) / 10, views: r.views, average: Math.round(r.average), excluded: r.excluded_reason }));
}

export async function publicTrending(db: Db, now = new Date()): Promise<{ date: string | null; cards: TrendingCardDto[] }> {
  const date = await activeRun(db, now);
  return { date, cards: date ? await trendingOf(db, date, false) : [] };
}

/** Admin : écarter (ou rétablir) une carte du jour, même déjà publiée. */
export async function setExcluded(db: Db, date: string, cardId: string, excluded: boolean): Promise<boolean> {
  const done = await db.query(`UPDATE trending SET excluded_reason = ${excluded ? "'admin'" : 'NULL'} WHERE date = $1 AND card_id = $2 RETURNING 1`, [date, cardId]);
  return done.length > 0;
}

/**
 * Ordonnanceur : vérifie chaque minute s'il faut calculer (heure de calcul passée, pas encore de calcul du
 * jour) ou publier (heure de publication passée). Une erreur réseau est retentée à la minute suivante.
 */
export class TrendingScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly config: TrendingConfig,
    private readonly catalog: () => CatalogSnapshot,
    private readonly source: ViewsSource,
    private readonly log: (msg: string, err?: unknown) => void,
  ) {}

  start(): void {
    void this.tick(new Date());
    this.timer = setInterval(() => void this.tick(new Date()), 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now: Date): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const date = dateKey(now);
      const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const [run] = await this.db.query<{ published_at: string | null }>('SELECT published_at FROM trending_runs WHERE date = $1', [date]);
      if (!run && minutes >= this.config.computeHour * 60) {
        await computeTrending(this.db, this.config, this.catalog(), this.source, now);
        this.log(`Tendance du jour calculée (${date}).`);
      }
      if ((run || minutes >= this.config.computeHour * 60) && !run?.published_at && minutes >= this.config.publishHour * 60 + this.config.publishMinute) {
        await publishTrending(this.db, date);
        this.log(`Tendance du jour publiée (${date}).`);
      }
    } catch (err) {
      this.log('Tendance du jour : échec, nouvel essai dans une minute.', err);
    } finally {
      this.running = false;
    }
  }
}
