import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.js';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Create an opaque bearer token. Only its SHA-256 hash is stored server-side. */
export async function createSession(db: Db, userId: string, now: number, ttlHours: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at) VALUES ($1,$2,$3,$4,$3)', [
    hashToken(token),
    userId,
    new Date(now),
    new Date(now + ttlHours * 3_600_000),
  ]);
  return token;
}

export interface SessionUser {
  id: string;
  username: string;
  role: 'player' | 'moderator' | 'admin' | 'superadmin';
  suspended: boolean;
}

export async function resolveSession(db: Db, token: string, now: number): Promise<SessionUser | null> {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.role, u.suspended FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [hashToken(token), new Date(now)],
  );
  if (!rows[0]) return null;
  return rows[0];
}

export async function deleteSession(db: Db, token: string) {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}
