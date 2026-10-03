import type { BudgetReport, CardDef, CategoryId, SimulationResult } from '@rabbithole/engine';
import type { PublicUser } from '@rabbithole/shared';

/** Erreur de l'API : `code` = champ `error`, `details` = précisions (erreurs de validation, blocages…). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: unknown,
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? 'error'), json.details);
  return json as T;
}

/** Texte lisible d'une erreur (détails compris). */
export function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return String(err);
  const d = err.details;
  if (Array.isArray(d)) return `${err.code} : ${d.join(' · ')}`;
  if (d && typeof d === 'object') return `${err.code} : ${JSON.stringify(d)}`;
  return err.code;
}

export type PolicyStatus = 'ok' | 'needs_review' | 'excluded';
export type CardStatus = 'draft' | 'review' | 'published' | 'retired';

export interface CandidateRow {
  qid: string;
  status: 'new' | 'shortlisted' | 'rejected' | 'carded';
  cardId: string | null;
  name: string;
  description: string;
  kind: string;
  categories: CategoryId[];
  countries: string[];
  sitelinks: number;
  /** Vues Wikipédia par an (estimées sur 60 jours). */
  viewsYear: number | null;
  score: { total: number; iconic: boolean; meetsThreshold: boolean } | null;
  policy: { status: PolicyStatus; reasons: string[] } | null;
  flags: { adult?: boolean; sensitive?: boolean; politicallySensitive?: boolean };
  image: { thumb: string | null; license: string; accepted: boolean; author: string } | null;
}

export interface CardRow {
  id: string;
  series: string;
  status: CardStatus;
  name: string;
  type: CardDef['type'];
  rarity: string;
  categories: CategoryId[];
  cost: number;
  power: number;
  policy: PolicyStatus;
  budget: { delta: number; verdict: BudgetReport['verdict'] } | null;
}

export interface CardImage {
  id: string;
  source_url: string;
  file_page: string;
  author: string;
  license: string;
  license_url: string | null;
  personality_warning: boolean;
  active: boolean;
}

export interface Preview {
  errors: string[];
  budget: BudgetReport | null;
  text: { keyword?: string; text: string }[];
}

export interface CardDetail extends Preview {
  id: string;
  series: string;
  status: CardStatus;
  version: number;
  def: CardDef;
  policy: { status: PolicyStatus; reasons: string[] };
  images: CardImage[];
}

export interface SeriesRow {
  id: string;
  type: string;
  country: string | null;
  name: Record<string, string>;
  status: 'draft' | 'review' | 'published';
  cards: number;
  published: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  target: string | null;
  payload: unknown;
  created_at: string;
  admin: string | null;
}

export interface ReportRow {
  id: string;
  target_type: 'card' | 'player';
  card_id: string | null;
  card_name: string | null;
  match_id: string | null;
  target_user: string | null;
  reporter: string | null;
  reason: string;
  details: string | null;
  status: string;
  resolution: string | null;
  created_at: string;
  open_on_target: number;
}

export interface TakedownRow {
  id: string;
  card_id: string;
  card_name: string | null;
  card_status: string | null;
  requester_name: string;
  requester_contact: string;
  relation: string;
  reason: string;
  status: 'open' | 'in_progress' | 'done' | 'rejected';
  resolution: string | null;
  created_at: string;
  due_at: string;
  overdue: boolean;
}

export interface CountryRuleRow {
  country: string;
  allow_adult: boolean;
  allow_political: boolean;
  blocked_card_ids: string[];
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  session: () => request<{ user: PublicUser | null }>('GET', '/session'),
  login: (email: string, password: string) => request<{ user: PublicUser }>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),

  overview: () => request<{ counts: Record<string, number>; catalogVersion: string }>('GET', '/admin/overview'),

  importCandidates: (run: unknown) => request<{ imported: number; updated: number }>('POST', '/admin/candidates/import', run),
  candidates: (f: { category?: string; status?: string; policy?: string; q?: string; minScore?: number; limit?: number; offset?: number }) =>
    request<{ total: number; candidates: CandidateRow[] }>('GET', `/admin/candidates${qs(f)}`),
  candidateStatus: (qid: string, status: 'new' | 'shortlisted' | 'rejected') => request<{ ok: true }>('POST', `/admin/candidates/${qid}/status`, { status }),
  cardFromCandidate: (qid: string, series: string, type: CardDef['type']) => request<{ card: CardDef }>('POST', `/admin/candidates/${qid}/card`, { series, type }),

  cards: (f: { series?: string; status?: string; q?: string }) => request<{ cards: CardRow[] }>('GET', `/admin/cards${qs(f)}`),
  card: (id: string) => request<CardDetail>('GET', `/admin/cards/${encodeURIComponent(id)}`),
  createCard: (series: string, type: CardDef['type'], name: string) => request<{ card: CardDef }>('POST', '/admin/cards', { series, type, name }),
  importDrafts: (file: { series: string; seriesInfo?: unknown; cards: unknown[] }) =>
    request<{ created: string[]; skipped: { id: string; reason: string; details?: unknown }[] }>('POST', '/admin/cards/import', file),
  preview: (def: CardDef) => request<Preview>('POST', '/admin/cards/preview', { def }),
  saveCard: (id: string, def: CardDef) => request<{ status: CardStatus; version: number }>('PUT', `/admin/cards/${encodeURIComponent(id)}`, { def }),
  cardStatus: (id: string, status: CardStatus) => request<{ ok: true; catalogVersion: string }>('POST', `/admin/cards/${encodeURIComponent(id)}/status`, { status }),
  /** Effacée si jamais publiée, sinon retirée du jeu. */
  removeCard: (id: string) => request<{ result: 'deleted' | 'retired' }>('DELETE', `/admin/cards/${encodeURIComponent(id)}`),
  imageActive: (id: string, imageId: string, active: boolean) => request<{ ok: true }>('POST', `/admin/cards/${encodeURIComponent(id)}/images/${imageId}`, { active }),

  series: () => request<{ series: SeriesRow[] }>('GET', '/admin/series'),
  createSeries: (s: { id: string; type: string; country: string | null; name: { fr: string; en: string } }) => request<{ ok: true }>('POST', '/admin/series', s),
  seriesStatus: (id: string, status: SeriesRow['status']) => request<{ ok: true; catalogVersion: string }>('POST', `/admin/series/${id}/status`, { status }),

  budget: () => request<{ cards: { id: string; status: string; report: BudgetReport }[] }>('GET', '/admin/budget'),
  decks: () => request<{ decks: { id: string; name: Record<string, string>; leader: string; series: string }[] }>('GET', '/admin/decks'),
  importDecks: (file: { series: string; decks: unknown[] }) =>
    request<{ imported: string[]; invalid: { id: string; errors: string[] }[] }>('POST', '/admin/decks/import', file),
  simulate: (body: { a: { prebuilt: string }; b: { prebuilt: string }; games: number; includeDrafts: boolean }) => request<SimulationResult>('POST', '/admin/simulate', body),

  reports: (status: 'open' | 'resolved' | 'dismissed') => request<{ reports: ReportRow[] }>('GET', `/admin/reports${qs({ status })}`),
  resolveReport: (id: string, status: 'resolved' | 'dismissed', resolution: string) => request<{ ok: true }>('POST', `/admin/reports/${id}`, { status, resolution }),
  takedowns: () => request<{ takedowns: TakedownRow[] }>('GET', '/admin/takedowns'),
  handleTakedown: (id: string, status: TakedownRow['status'], resolution: string, retireCard: boolean) =>
    request<{ ok: true }>('POST', `/admin/takedowns/${id}`, { status, resolution, retireCard }),
  countryRules: () => request<{ rules: CountryRuleRow[] }>('GET', '/admin/country-rules'),
  setCountryRule: (country: string, rule: { allowAdult: boolean; allowPolitical: boolean; blockedCardIds: string[] }) =>
    request<{ ok: true }>('PUT', `/admin/country-rules/${country}`, rule),

  audit: (limit = 200) => request<{ entries: AuditEntry[] }>('GET', `/admin/audit${qs({ limit })}`),
};
