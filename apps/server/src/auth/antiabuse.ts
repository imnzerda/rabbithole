import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db/db.js';

/**
 * Anti-double compte par l'appareil (section 14). Deux signaux :
 * - **empreinte numérique** (`fp`) calculée par le navigateur (`apps/web/src/lib/fingerprint.ts` :
 *   processeur, carte graphique, écran, polices, rendu canvas et audio…), qui résiste à l'effacement
 *   des cookies et à la navigation privée ;
 * - **cookie** d'appareil httpOnly posé par le serveur.
 * Les comptes qui partagent un appareil ou une IP sont signalés (`account_flags`)
 * et ne pourront pas échanger entre eux (phase 5).
 * Aucune IP ni aucun identifiant d'appareil n'est stocké en clair : uniquement des empreintes salées.
 * Les autres protections (captcha, débit, e-mails, SMS, VPN) sont dans `guard.ts` et `signup.ts`.
 */

export const DEVICE_COOKIE = 'rh_device';

declare module 'fastify' {
  interface FastifyRequest {
    deviceId: string | null;
  }
}

export type DeviceKind = 'cookie' | 'fp';

/** Signaux d'une requête, déjà hachés. `fp` est absent si le navigateur ne l'a pas fourni. */
export interface Signals {
  cookie: string;
  fp: string | null;
  ip: string;
}

export function signalHash(value: string, config: ServerConfig): string {
  return createHash('sha256').update(`${config.signalSalt}:${value}`).digest('hex');
}

export function requestSignals(request: FastifyRequest, config: ServerConfig, client: { fp?: string | undefined }): Signals {
  return {
    cookie: signalHash(`device:${request.deviceId}`, config),
    fp: client.fp ? signalHash(`fp:${client.fp}`, config) : null,
    ip: signalHash(`ip:${request.ip}`, config),
  };
}

/** Pose un identifiant d'appareil (cookie httpOnly longue durée) s'il n'existe pas encore. */
export function ensureDevice(request: FastifyRequest, reply: FastifyReply, config: ServerConfig): void {
  const existing = request.cookies[DEVICE_COOKIE];
  if (existing && /^[A-Za-z0-9_-]{20,64}$/.test(existing)) {
    request.deviceId = existing;
    return;
  }
  const id = randomBytes(24).toString('base64url');
  request.deviceId = id;
  reply.setCookie(DEVICE_COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 2 * 365 * 24 * 3600 });
}

export interface DeviceCheck {
  /** Appareil déjà associé à un compte : inscription refusée. */
  blocked: boolean;
  /** Empreinte déjà vue sur un compte, mais depuis une autre IP : vérification renforcée (SMS). */
  seenElsewhere: boolean;
}

/**
 * Un appareil = un compte. Refusé si :
 * - le cookie d'appareil appartient déjà à un compte ;
 * - l'empreinte appartient déjà à un compte vu depuis la même IP.
 * Ailleurs (deux téléphones du même modèle peuvent avoir la même empreinte), l'appareil est « vu ailleurs » :
 * l'inscription demande alors une vérification par SMS. `fingerprintStrict` refuse dans tous les cas.
 */
export async function checkDevices(db: Db, config: ServerConfig, s: Signals): Promise<DeviceCheck> {
  const [cookie] = await db.query(`SELECT 1 FROM user_devices WHERE device_hash = $1 AND kind = 'cookie' LIMIT 1`, [s.cookie]);
  if (cookie) return { blocked: true, seenElsewhere: false };
  if (!s.fp) return { blocked: false, seenElsewhere: false };
  const rows = await db.query<{ same_ip: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM user_ips i WHERE i.user_id = d.user_id AND i.ip_hash = $2) AS same_ip
     FROM user_devices d WHERE d.device_hash = $1 AND d.kind = 'fp'`,
    [s.fp, s.ip],
  );
  if (rows.length === 0) return { blocked: false, seenElsewhere: false };
  if (config.fingerprintStrict || rows.some((r) => r.same_ip)) return { blocked: true, seenElsewhere: false };
  return { blocked: false, seenElsewhere: true };
}

/**
 * Enregistre les appareils et le réseau d'une connexion, puis signale les autres comptes
 * qui les partagent (revue humaine : un foyer peut partager un ordinateur).
 */
export async function recordSignals(db: Db, userId: string, s: Signals): Promise<void> {
  const devices: [string, DeviceKind][] = [[s.cookie, 'cookie']];
  if (s.fp) devices.push([s.fp, 'fp']);
  for (const [hash, kind] of devices) {
    await db.query(
      `INSERT INTO user_devices (device_hash, user_id, kind) VALUES ($1, $2, $3)
       ON CONFLICT (device_hash, user_id) DO UPDATE SET last_seen = now()`,
      [hash, userId, kind],
    );
    await flagShared(db, userId, 'user_devices', 'device_hash', hash, 'shared_device');
  }
  await db.query(
    `INSERT INTO user_ips (ip_hash, user_id) VALUES ($1, $2)
     ON CONFLICT (ip_hash, user_id) DO UPDATE SET last_seen = now()`,
    [s.ip, userId],
  );
  await flagShared(db, userId, 'user_ips', 'ip_hash', s.ip, 'shared_ip');
}

async function flagShared(db: Db, userId: string, table: 'user_devices' | 'user_ips', column: 'device_hash' | 'ip_hash', hash: string, reason: string): Promise<void> {
  await db.query(
    `INSERT INTO account_flags (user_id, other_user_id, reason)
     SELECT DISTINCT $1::uuid, t.user_id, $3 FROM ${table} t WHERE t.${column} = $2 AND t.user_id <> $1
     ON CONFLICT DO NOTHING`,
    [userId, hash, reason],
  );
}

/** Comptes liés (même appareil ou même réseau), signalés pour revue. */
export async function linkedAccounts(db: Db, userId: string): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `SELECT DISTINCT other_user_id AS id FROM account_flags WHERE user_id = $1
     UNION SELECT DISTINCT user_id AS id FROM account_flags WHERE other_user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.id);
}
