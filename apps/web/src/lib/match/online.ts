import type { GameAction, MatchContext, PlayerIndex } from '@rabbithole/engine';
import type { ClientMessage, OpponentInfo, PlayerCosmetics, QueueMode, RankedResultDto, ServerMessage } from '@rabbithole/shared';
import { BaseMatchClient, type MatchClient, type MatchStep } from './client';

/** Partie en ligne : le serveur fait foi, ce client ne fait qu'envoyer des actions et relayer les étapes. */
export class OnlineMatch extends BaseMatchClient implements MatchClient {
  readonly spectator = false;
  private buffered: MatchStep[] = [];
  private started = false;

  constructor(
    readonly ctx: MatchContext,
    readonly matchId: string,
    readonly you: PlayerIndex,
    readonly opponent: OpponentInfo,
    private readonly send: (m: ClientMessage) => void,
    all: [PlayerCosmetics, PlayerCosmetics] = [
      { variants: {}, title: null },
      { variants: {}, title: null },
    ],
  ) {
    super();
    this.cosmetics = { mine: all[you], theirs: all[you === 0 ? 1 : 0] };
  }

  readonly cosmetics: { mine: PlayerCosmetics; theirs: PlayerCosmetics };

  get opponentName(): string {
    return this.opponent.name;
  }

  /** Appelé par la connexion pour chaque étape reçue du serveur. */
  receive(step: MatchStep): void {
    if (this.started) this.emitStep(step);
    else this.buffered.push(step);
  }

  receiveEnd(reward: number | null, ranked: RankedResultDto | null = null): void {
    if (ranked) this.emitRanked(ranked);
    this.emitReward(reward);
  }

  receiveError(code: string, message: string): void {
    this.emitError({ code, message });
  }

  start(): void {
    this.started = true;
    for (const s of this.buffered.splice(0)) this.emitStep(s);
  }

  act(action: GameAction): void {
    this.send({ t: 'action', action });
  }

  close(): void {
    // La connexion est gérée par `Lobby` ; une partie en cours reprend à la reconnexion.
  }
}

export type LobbyState =
  | { kind: 'connecting' }
  | { kind: 'idle' }
  | { kind: 'queued'; mode: QueueMode; since: number; ghostAt: number | null }
  | { kind: 'playing'; match: OnlineMatch }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'closed' };

/** Connexion WebSocket au serveur : file d'attente, puis partie. Reconnexion automatique. */
export class Lobby {
  private ws: WebSocket | null = null;
  private match: OnlineMatch | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  state: LobbyState = { kind: 'connecting' };

  constructor(
    private readonly ctx: MatchContext,
    /** Version du catalogue chargé : une partie sur une autre version recharge la page (catalogue publié entre-temps). */
    private readonly contentVersion: string,
    private readonly onChange: (state: LobbyState) => void,
  ) {}

  private set(state: LobbyState): void {
    this.state = state;
    this.onChange(state);
  }

  connect(): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.ws = ws;
    ws.onmessage = (e) => this.handle(JSON.parse(String(e.data)) as ServerMessage);
    ws.onclose = (e) => {
      this.ws = null;
      if (this.stopped) return;
      if (e.code === 4401) {
        this.set({ kind: 'error', code: 'unauthorized', message: 'Session expirée.' });
        return;
      }
      // Coupure réseau : on se reconnecte ; le serveur renverra la partie en cours.
      this.retry = setTimeout(() => this.connect(), 1500);
    };
  }

  private send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private handle(m: ServerMessage): void {
    switch (m.t) {
      case 'hello':
        if (this.state.kind === 'connecting') this.set({ kind: 'idle' });
        break;
      case 'queued':
        this.set({ kind: 'queued', mode: m.mode, since: Date.now(), ghostAt: m.ghostInMs === null ? null : Date.now() + m.ghostInMs });
        break;
      case 'cancelled':
        this.set({ kind: 'idle' });
        break;
      case 'match_start':
        if (m.contentVersion !== this.contentVersion) {
          // La partie a repris à la reconnexion avec le bon catalogue.
          location.reload();
          return;
        }
        if (this.match?.matchId !== m.matchId) {
          this.match = new OnlineMatch(this.ctx, m.matchId, m.you, m.opponent, (msg) => this.send(msg), m.cosmetics);
          this.set({ kind: 'playing', match: this.match });
        }
        break;
      case 'step':
        if (this.match?.matchId === m.matchId) this.match.receive({ events: m.events, view: m.view, deadline: m.deadline });
        break;
      case 'match_end':
        if (this.match?.matchId === m.matchId) this.match.receiveEnd(m.reward, m.ranked);
        break;
      case 'error':
        if (this.match && this.state.kind === 'playing') this.match.receiveError(m.code, m.message);
        else this.set({ kind: 'error', code: m.code, message: m.message });
        break;
    }
  }

  queue(deckId: string, mode: QueueMode): void {
    this.send({ t: 'queue', deckId, mode });
  }

  cancel(): void {
    this.send({ t: 'cancel' });
  }

  /** Défi du jour : partie contre l'IA avec le deck imposé (une tentative comptée par jour). */
  daily(): void {
    this.send({ t: 'daily' });
  }

  /** Draft du week-end : file draft avec le deck du draft en cours (fantôme après l'attente). */
  draft(): void {
    this.send({ t: 'draft' });
  }

  /** Retour au salon après une partie. */
  leaveMatch(): void {
    this.match = null;
    this.set({ kind: 'idle' });
  }

  close(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
    this.set({ kind: 'closed' });
  }
}
