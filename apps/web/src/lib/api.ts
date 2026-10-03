import { deviceFingerprint } from './fingerprint';
import type { AuthConfigDto, SignupResponse, BoostersResponse, DeckDto, FriendsDto, MatchSummary, PublicUser, ReplayData, TradeDto, TradeUpOfferDto, WalletDto } from '@rabbithole/shared';

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
  /** Jeton du captcha invisible (Turnstile), s'il est activé. */
  captchaToken?: string;
  /** Pot de miel : toujours vide pour un humain. */
  website: string;
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
  authConfig: () => request<AuthConfigDto>('GET', '/auth/config'),
  // L'empreinte numérique de l'appareil accompagne l'inscription et la connexion (anti-double compte).
  signup: async (input: SignupInput) => request<SignupResponse>('POST', '/auth/signup', { ...input, fp: await deviceFingerprint() }),
  signupPhone: (pendingId: string, phone: string) => request<{ phone: string }>('POST', `/auth/signup/${pendingId}/phone`, { phone }),
  signupVerify: (pendingId: string, code: string) => request<{ user: PublicUser }>('POST', `/auth/signup/${pendingId}/verify`, { code }),
  login: async (email: string, password: string) =>
    request<{ user: PublicUser }>('POST', '/auth/login', { email, password, fp: await deviceFingerprint() }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  settings: (showSensitive: boolean) => request<{ showSensitive: boolean }>('POST', '/me/settings', { showSensitive }),
  report: (target: { type: 'card'; cardId: string } | { type: 'player'; matchId: string }, reason: string, details: string) =>
    request<{ ok: true }>('POST', '/reports', { target, reason, ...(details.trim() ? { details: details.trim() } : {}) }),
  takedown: (body: { cardId: string; name: string; contact: string; relation: string; reason: string }) => request<{ id: string; dueAt: string }>('POST', '/takedown', body),

  collection: () => request<{ cards: { cardId: string; quantity: number }[] }>('GET', '/collection'),
  wallet: () => request<{ wallet: WalletDto }>('GET', '/wallet'),
  boosters: () => request<BoostersResponse>('GET', '/boosters'),
  purchase: (type: string, cardIds: string[]) =>
    request<{ cards: string[]; preview: { cardIds: string[]; refreshAt: string }; wallet: WalletDto }>('POST', `/boosters/${type}/purchase`, { cardIds }),
  openFree: (type: string) => request<{ cards: string[]; wallet: WalletDto }>('POST', `/boosters/${type}/open-free`),
  recycle: (cardId: string, count: number) => request<{ wallet: WalletDto }>('POST', '/collection/recycle', { cardId, count }),
  craft: (cardId: string) => request<{ wallet: WalletDto }>('POST', '/collection/craft', { cardId }),
  tradeUpOffer: (rarity: string, category: string | null) =>
    request<{ offer: TradeUpOfferDto }>('GET', `/trade-up?rarity=${rarity}${category ? `&category=${category}` : ''}`),
  tradeUp: (cards: { cardId: string; count: number }[], category: string | null) =>
    request<{ card: string; offer: TradeUpOfferDto }>('POST', '/trade-up', { cards, ...(category ? { category } : {}) }),
  starterLeader: (leaderId: string) => request<{ ok: true }>('POST', '/starter-leader', { leaderId }),

  friends: () => request<FriendsDto>('GET', '/friends'),
  addFriend: (target: { code: string } | { name: string }) => request<{ id: string; name: string; accepted: boolean }>('POST', '/friends', target),
  acceptFriend: (id: string) => request<{ ok: true }>('POST', `/friends/${id}/accept`),
  removeFriend: (id: string) => request<{ ok: true }>('DELETE', `/friends/${id}`),
  friendCollection: (id: string) => request<{ cards: { cardId: string; quantity: number }[] }>('GET', `/friends/${id}/collection`),
  trades: () =>
    request<{ incoming: TradeDto[]; outgoing: TradeDto[]; history: TradeDto[]; limits: { expiryHours: number } }>('GET', '/trades'),
  proposeTrade: (toUserId: string, offered: { cardId: string; quantity: number }[], requested: { cardId: string; quantity: number }[]) =>
    request<{ trade: TradeDto }>('POST', '/trades', { toUserId, offered, requested }),
  tradeAction: (id: string, action: 'accept' | 'decline' | 'cancel') => request<{ trade?: TradeDto }>('POST', `/trades/${id}/${action}`),

  decks: () => request<{ decks: DeckDto[] }>('GET', '/decks'),
  createDeck: (deck: DeckInput) => request<{ deck: DeckDto }>('POST', '/decks', deck),
  updateDeck: (id: string, deck: DeckInput) => request<{ deck: DeckDto }>('PUT', `/decks/${id}`, deck),
  deleteDeck: (id: string) => request<{ ok: true }>('DELETE', `/decks/${id}`),

  matches: () => request<{ matches: MatchSummary[] }>('GET', '/matches'),
  replay: (id: string) => request<{ replay: ReplayData }>('GET', `/replays/${id}`),
};
