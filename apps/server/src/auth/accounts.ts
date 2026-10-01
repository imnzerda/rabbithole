import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Db } from '../db/db.js';

export interface User {
  id: string;
  email: string;
  displayName: string;
  birthDate: string;
  country: string;
  locale: string;
  createdAt: string;
}

/** Données publiques renvoyées au client (jamais le hash ni la date de naissance complète). */
export function publicUser(u: User) {
  return { id: u.id, email: u.email, displayName: u.displayName, country: u.country, locale: u.locale, createdAt: u.createdAt };
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  birth_date: string | Date;
  country: string;
  locale: string;
  created_at: string | Date;
  password_hash: string;
}

const isoDate = (d: string | Date) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

function toUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    birthDate: isoDate(r.birth_date),
    country: r.country,
    locale: r.locale,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

/** Âge révolu à une date donnée, à partir d'une date de naissance AAAA-MM-JJ. */
export function ageOn(birthDate: string, today: Date): number {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function findUserByEmail(db: Db, email: string): Promise<(User & { passwordHash: string }) | null> {
  const [row] = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export async function getUser(db: Db, id: string): Promise<User | null> {
  const [row] = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return row ? toUser(row) : null;
}

export async function createUser(
  db: Db,
  input: { email: string; passwordHash: string; displayName: string; birthDate: string; country: string; locale: string },
): Promise<User> {
  const [row] = await db.query<UserRow>(
    `INSERT INTO users (email, password_hash, display_name, birth_date, country, locale)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.email, input.passwordHash, input.displayName, input.birthDate, input.country, input.locale],
  );
  return toUser(row!);
}

/** Vérifie un mot de passe ; renvoie `null` dans tous les cas d'échec (pas d'indice sur l'existence du compte). */
export async function checkCredentials(db: Db, email: string, password: string): Promise<User | null> {
  const user = await findUserByEmail(db, email);
  if (!user) {
    // Temps de réponse comparable, que le compte existe ou non.
    await hash(password);
    return null;
  }
  return (await verify(user.passwordHash, password)) ? user : null;
}

// ---------------------------------------------------------------------------
// Sessions : jeton opaque aléatoire, seule son empreinte est stockée.
// ---------------------------------------------------------------------------

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Db, userId: string, days: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`, [
    tokenHash(token),
    userId,
    days,
  ]);
  return token;
}

export async function userForToken(db: Db, token: string): Promise<User | null> {
  const [row] = await db.query<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`,
    [tokenHash(token)],
  );
  return row ? toUser(row) : null;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
}
