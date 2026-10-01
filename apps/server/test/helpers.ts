import type { AddressInfo } from 'node:net';
import type { GameAction, PlayerView } from '@rabbithole/engine';
import type { ClientMessage, ServerMessage } from '@rabbithole/shared';
import WebSocket from 'ws';
import { buildApp, type App } from '../src/app.js';
import { testConfig, type ServerConfig } from '../src/config.js';

/** Date de naissance donnant exactement `years` ans aujourd'hui (moins `minusDays` jours). */
export function birthDateForAge(years: number, minusDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + minusDays);
  return d.toISOString().slice(0, 10);
}

export async function startApp(overrides: Partial<ServerConfig> = {}): Promise<App & { url: string }> {
  const built = await buildApp(testConfig(overrides));
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = built.app.server.address() as AddressInfo;
  return { ...built, url: `127.0.0.1:${port}` };
}

let counter = 0;

/** Crée un compte et renvoie son jeton de session. */
export async function signup(app: App['app'], name = `joueur${++counter}`): Promise<{ token: string; id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email: `${name}@example.com`, password: 'motdepasse1', displayName: name, birthDate: '1995-03-14', country: 'FR', locale: 'fr' },
  });
  if (res.statusCode !== 201) throw new Error(`signup ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'rh_session')!;
  return { token: cookie.value, id: res.json().user.id };
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Client WebSocket de test : mémorise les messages et permet d'attendre un message précis. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(m)) return true;
        w.resolve(m);
        return false;
      });
    });
  }

  static connect(url: string, token: string | null): Promise<TestClient> {
    const ws = new WebSocket(`ws://${url}/ws`, token ? { headers: auth(token) } : {});
    const client = new TestClient(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }

  act(action: GameAction): void {
    this.send({ t: 'action', action });
  }

  /** Attend un message (déjà reçu ou à venir) qui vérifie `pred`. */
  wait<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, timeoutMs = 15_000): Promise<Extract<ServerMessage, { t: T }>> {
    type M = Extract<ServerMessage, { t: T }>;
    const match = (m: ServerMessage): m is M => m.t === t && pred(m as M);
    const found = this.messages.find(match);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`attente de « ${t} » expirée`)), timeoutMs);
      this.waiters.push({
        pred: match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as M);
        },
      });
    });
  }

  get view(): PlayerView | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (m.t === 'step') return m.view;
    }
    return null;
  }

  close(): void {
    this.ws.close();
  }
}

/** Décision simple prise à partir de la seule vue du joueur : poser, attaquer le Leader, sinon finir le tour. */
export function simpleAction(view: PlayerView): GameAction | null {
  const legal = view.legal;
  if (!legal) return null;
  switch (legal.kind) {
    case 'mulligan':
      return { type: 'mulligan', redraw: false };
    case 'block':
      return { type: 'block', blocker: null };
    case 'counter':
      return { type: 'counter', uids: [] };
    case 'trigger':
      return { type: 'trigger', activate: true };
    case 'main': {
      const play = legal.playable[0];
      if (play) return { type: 'play', uid: play };
      const a = legal.attackers[0];
      if (a) return { type: 'attack', attacker: a.uid, target: a.targets[0]! };
      return { type: 'end_turn' };
    }
  }
}

/**
 * Joue automatiquement pour ce client : à chaque nouvelle vue où il doit décider, il agit.
 * Renvoie une promesse résolue à la fin de partie.
 */
export function autoPlay(client: TestClient): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => {
      if (client.messages.some((m) => m.t === 'match_end')) return resolve();
      const view = client.view;
      const action = view ? simpleAction(view) : null;
      if (action) client.act(action);
    };
    let last = -1;
    const onMessage = () => {
      const steps = client.messages.filter((m) => m.t === 'step').length;
      if (steps !== last) {
        last = steps;
        tick();
      }
      if (client.messages.some((m) => m.t === 'match_end')) {
        client.ws.off('message', onMessage);
        resolve();
      }
    };
    client.ws.on('message', onMessage);
    tick();
  });
}
