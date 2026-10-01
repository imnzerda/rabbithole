import { createHash, randomInt } from 'node:crypto';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db/db.js';
import { createUser, type User } from './accounts.js';
import { recordSignals, signalHash, type Signals } from './antiabuse.js';
import type { Guard } from './guard.js';
import { maskPhone, normalizePhone } from './phone.js';

/**
 * Inscription en deux temps quand une vérification par SMS est demandée :
 * 1. le formulaire passe toutes les vérifications → inscription « en attente » (30 min) ;
 * 2. le joueur reçoit un code par SMS, le saisit → le compte est créé.
 * Un numéro ne sert qu'à un compte. Le captcha n'est demandé qu'une fois, à l'étape 1.
 */

export type RiskReason = 'always' | 'vpn' | 'device_elsewhere';

export interface SignupPayload {
  email: string;
  canonicalEmail: string;
  passwordHash: string;
  displayName: string;
  country: string;
  locale: string;
}

export class SignupError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

const PENDING_MINUTES = 30;

interface PendingRow {
  id: string;
  payload: SignupPayload;
  signals: Signals;
  phone_hash: string | null;
  code_hash: string | null;
  code_expires_at: string | Date | null;
  attempts: number;
}

const codeHash = (config: ServerConfig, id: string, code: string) => createHash('sha256').update(`${config.signalSalt}:sms:${id}:${code}`).digest('hex');

/** Crée le compte, son portefeuille et enregistre ses signaux (dans une transaction). */
export async function finishSignup(db: Db, config: ServerConfig, payload: SignupPayload, signals: Signals, phoneHash: string | null): Promise<User> {
  try {
    return await db.transaction(async (tx) => {
      const user = await createUser(tx, { ...payload, phoneHash, welcomeBoosters: config.economy.welcomeBoosters });
      await recordSignals(tx, user.id, signals);
      return user;
    });
  } catch (err) {
    // Course entre deux inscriptions (même e-mail ou même numéro) : l'index unique tranche.
    if (String((err as { code?: string }).code) === '23505') throw new SignupError(phoneHash ? 'phone_taken' : 'email_taken', 409);
    throw err;
  }
}

export async function createPending(db: Db, payload: SignupPayload, signals: Signals, reasons: RiskReason[]): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO pending_signups (payload, signals, reasons, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4)) RETURNING id`,
    [JSON.stringify(payload), JSON.stringify(signals), reasons, PENDING_MINUTES],
  );
  return row!.id;
}

async function getPending(db: Db, id: string): Promise<PendingRow> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new SignupError('pending_expired', 404);
  const [row] = await db.query<PendingRow>('SELECT * FROM pending_signups WHERE id = $1 AND expires_at > now()', [id]);
  if (!row) throw new SignupError('pending_expired', 404);
  return row;
}

/** Envoie un code au numéro donné, après contrôle du numéro et des limites d'envoi. */
export async function sendPhoneCode(
  db: Db,
  config: ServerConfig,
  guard: Guard,
  id: string,
  rawPhone: string,
  ipHash: string,
): Promise<{ phone: string }> {
  const pending = await getPending(db, id);
  const g = config.guard;
  const phone = normalizePhone(rawPhone, pending.payload.country, g.smsCountries);
  if ('error' in phone) throw new SignupError(phone.error, 400);
  const phoneHash = signalHash(`phone:${phone.e164}`, config);

  const [taken] = await db.query('SELECT 1 FROM users WHERE phone_hash = $1', [phoneHash]);
  if (taken) throw new SignupError('phone_taken', 409);

  const [counts] = await db.query<{ phone: number; ip: number }>(
    `SELECT (SELECT count(*)::int FROM sms_sends WHERE phone_hash = $1 AND created_at > now() - interval '1 hour') AS phone,
            (SELECT count(*)::int FROM sms_sends WHERE ip_hash = $2 AND created_at > now() - interval '1 hour') AS ip`,
    [phoneHash, ipHash],
  );
  if ((counts?.phone ?? 0) >= g.smsPerPhonePerHour || (counts?.ip ?? 0) >= g.smsPerIpPerHour) throw new SignupError('sms_rate_limited', 429);

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.query(
    `UPDATE pending_signups SET phone_hash = $2, code_hash = $3, attempts = 0,
       code_expires_at = now() + make_interval(mins => $4) WHERE id = $1`,
    [id, phoneHash, codeHash(config, id, code), g.smsCodeMinutes],
  );
  await db.query('INSERT INTO sms_sends (phone_hash, ip_hash) VALUES ($1, $2)', [phoneHash, ipHash]);
  await guard.sms.send(phone.e164, `RABBIT HOLE : ton code est ${code}. Il expire dans ${g.smsCodeMinutes} min. Ne le partage avec personne.`);
  return { phone: maskPhone(phone.e164) };
}

/** Vérifie le code reçu par SMS ; si c'est le bon, crée le compte. */
export async function verifyPhoneCode(db: Db, config: ServerConfig, id: string, code: string): Promise<User> {
  const pending = await getPending(db, id);
  if (!pending.code_hash || !pending.phone_hash || !pending.code_expires_at) throw new SignupError('no_code_sent', 400);
  if (new Date(pending.code_expires_at).getTime() < Date.now()) throw new SignupError('code_expired', 400);
  if (pending.attempts >= config.guard.smsMaxAttempts) throw new SignupError('too_many_attempts', 429);
  if (codeHash(config, id, code.trim()) !== pending.code_hash) {
    await db.query('UPDATE pending_signups SET attempts = attempts + 1 WHERE id = $1', [id]);
    const left = config.guard.smsMaxAttempts - pending.attempts - 1;
    throw new SignupError(left > 0 ? 'bad_code' : 'too_many_attempts', left > 0 ? 400 : 429, { attemptsLeft: left });
  }
  const user = await finishSignup(db, config, pending.payload, pending.signals, pending.phone_hash);
  await db.query('UPDATE users SET phone_verified_at = now() WHERE id = $1', [user.id]);
  await db.query('DELETE FROM pending_signups WHERE id = $1 OR expires_at < now()', [id]);
  return user;
}
