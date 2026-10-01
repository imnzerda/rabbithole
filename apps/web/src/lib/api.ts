import type { DeckDto, MatchSummary, PublicUser, ReplayData } from '@rabbithole/shared';

/** Erreur renvoyée par l'API (`code` = champ `error` de la réponse). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
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
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? 'error'), json);
  return json as T;
}

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
  birthDate: string;
  country: string;
  locale: string;
}

/** API REST du serveur (même origine : le serveur de dev relaie `/api` et `/ws`). */
export const api = {
  me: () => request<{ user: PublicUser }>('GET', '/me'),
  session: () => request<{ user: PublicUser | null }>('GET', '/session'),
  signup: (input: SignupInput) => request<{ user: PublicUser }>('POST', '/auth/signup', input),
  login: (email: string, password: string) => request<{ user: PublicUser }>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  decks: () => request<{ decks: DeckDto[] }>('GET', '/decks'),
  matches: () => request<{ matches: MatchSummary[] }>('GET', '/matches'),
  replay: (id: string) => request<{ replay: ReplayData }>('GET', `/replays/${id}`),
};
