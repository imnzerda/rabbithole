import { hardwareId } from './hwid';
import type { BoostersResponse, DeckDto, MatchSummary, PublicUser, ReplayData, WalletDto } from '@rabbithole/shared';

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
  country: string;
  locale: string;
}

export interface DeckInput {
  name: string;
  leaderId: string;
  cardIds: string[];
}

/** API REST du serveur (même origine : le serveur de dev relaie `/api` et `/ws`). */
export const api = {
  me: () => request<{ user: PublicUser }>('GET', '/me'),
  session: () => request<{ user: PublicUser | null }>('GET', '/session'),
  // Le HWID accompagne l'inscription et la connexion (anti-double compte).
  signup: (input: SignupInput) => request<{ user: PublicUser }>('POST', '/auth/signup', { ...input, hwid: hardwareId() }),
  login: (email: string, password: string) => request<{ user: PublicUser }>('POST', '/auth/login', { email, password, hwid: hardwareId() }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),

  collection: () => request<{ cards: { cardId: string; quantity: number }[] }>('GET', '/collection'),
  wallet: () => request<{ wallet: WalletDto }>('GET', '/wallet'),
  boosters: () => request<BoostersResponse>('GET', '/boosters'),
  purchase: (type: string, cardIds: string[]) =>
    request<{ cards: string[]; preview: { cardIds: string[]; refreshAt: string }; wallet: WalletDto }>('POST', `/boosters/${type}/purchase`, { cardIds }),
  openFree: (type: string) => request<{ cards: string[]; wallet: WalletDto }>('POST', `/boosters/${type}/open-free`),
  recycle: (cardId: string, count: number) => request<{ wallet: WalletDto }>('POST', '/collection/recycle', { cardId, count }),
  craft: (cardId: string) => request<{ wallet: WalletDto }>('POST', '/collection/craft', { cardId }),
  starterLeader: (leaderId: string) => request<{ ok: true }>('POST', '/starter-leader', { leaderId }),

  decks: () => request<{ decks: DeckDto[] }>('GET', '/decks'),
  createDeck: (deck: DeckInput) => request<{ deck: DeckDto }>('POST', '/decks', deck),
  updateDeck: (id: string, deck: DeckInput) => request<{ deck: DeckDto }>('PUT', `/decks/${id}`, deck),
  deleteDeck: (id: string) => request<{ ok: true }>('DELETE', `/decks/${id}`),

  matches: () => request<{ matches: MatchSummary[] }>('GET', '/matches'),
  replay: (id: string) => request<{ replay: ReplayData }>('GET', `/replays/${id}`),
};
