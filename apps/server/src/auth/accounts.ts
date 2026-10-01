import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Db } from '../db/db.js';

export interface User {
  id: string;
  email: string;
  displayName: string;
  country: string;
  locale: string;
  starterLeader: string | null;
  role: 'player' | 'admin';
  createdAt: string;
}

/** Données renvoyées au client (jamais le hash ni les signaux anti-abus). */
export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    country: u.country,
    locale: u.locale,
    starterLeader: u.starterLeader,
    role: u.role,
    createdAt: u.createdAt,
  };
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  country: string;
  locale: string;
  starter_leader: string | null;
  role: 'player' | 'admin';
  created_at: string | Date;
  password_hash: string;
}

function toUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    country: r.country,
    locale: r.locale,
    starterLeader: r.starter_leader,
    role: r.role,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function findUserByEmail(db: Db, email: string): Promise<(User & { passwordHash: string }) | null> {
  const [row] = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

/** Unicité des comptes : l'e-mail canonique (alias et points Gmail ignorés, voir `canonicalEmail`). */
export async function canonicalEmailTaken(db: Db, canonical: string): Promise<boolean> {
  const [row] = await db.query('SELECT 1 FROM users WHERE canonical_email = $1', [canonical]);
  return !!row;
}

export async function getUser(db: Db, id: string): Promise<User | null> {
  const [row] = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return row ? toUser(row) : null;
}

export async function createUser(
  db: Db,
  input: {
    email: string;
    canonicalEmail: string;
    phoneHash: string | null;
    passwordHash: string;
    displayName: string;
    country: string;
    locale: string;
    welcomeBoosters: number;
  },
): Promise<User> {
  const [row] = await db.query<UserRow>(
    `INSERT INTO users (email, canonical_email, phone_hash, password_hash, display_name, country, locale)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [input.email, input.canonicalEmail, input.phoneHash, input.passwordHash, input.displayName, input.country, input.locale],
  );
  const user = toUser(row!);
  // Pas de cartes offertes : des boosters de bienvenue à ouvrir, pour construire sa collection.
  await db.query('INSERT INTO wallets (user_id, free_boosters) VALUES ($1, $2)', [user.id, input.welcomeBoosters]);
  if (input.welcomeBoosters > 0) {
    await db.query(`INSERT INTO coin_ledger (user_id, currency, amount, reason) VALUES ($1, 'free_boosters', $2, 'welcome')`, [
      user.id,
      input.welcomeBoosters,
    ]);
  }
  return user;
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

/**
 * Comptes administrateurs : les e-mails listés dans `ADMIN_EMAILS` reçoivent le rôle `admin`
 * (au démarrage, à l'inscription et à la connexion). Aucun autre moyen de devenir admin.
 */
export async function syncAdminRoles(db: Db, adminEmails: string[]): Promise<void> {
  if (adminEmails.length === 0) return;
  await db.query("UPDATE users SET role = 'admin' WHERE lower(email) = ANY($1::text[]) AND role <> 'admin'", [adminEmails.map((e) => e.trim().toLowerCase())]);
}
