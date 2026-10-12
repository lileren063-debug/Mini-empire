import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodTypeAny } from 'zod';
import type { AppContext } from '../context.js';
import { withTx, type Tx } from '../db.js';
import type { SessionUser } from '../auth/sessions.js';
import { AppError, forbidden } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in.');
  return req.user;
}

const ROLE_RANK = { player: 0, moderator: 1, admin: 2, superadmin: 3 } as const;
export function requireRole(req: FastifyRequest, role: keyof typeof ROLE_RANK): SessionUser {
  const u = requireUser(req);
  if (ROLE_RANK[u.role] < ROLE_RANK[role]) throw forbidden('Insufficient permissions.');
  return u;
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw new AppError(400, 'INVALID_INPUT', `${first.path.join('.') || 'input'}: ${first.message}`);
  }
  return r.data;
}

/** Per-user (or per-IP) rate limit. Throws 429. */
export function limit(ctx: AppContext, req: FastifyRequest, bucket: string, max: number, windowMs: number) {
  const who = req.user?.id ?? `ip:${req.ip}`;
  if (!ctx.rate.check(`${bucket}:${who}`, max, windowMs)) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.');
  }
}

const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;

/**
 * Run a state-changing request in one transaction with optional idempotency.
 * If the client sends `Idempotency-Key`, a retried request returns the stored response instead
 * of executing twice. Reusing a key with a different body is rejected.
 */
export async function mutation<T>(ctx: AppContext, req: FastifyRequest, fn: (tx: Tx, user: SessionUser) => Promise<T>): Promise<T> {
  const user = requireUser(req);
  const key = req.headers['idempotency-key'];
  return withTx(ctx.db, async (tx) => {
    if (typeof key === 'string') {
      if (!KEY_RE.test(key)) throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Invalid Idempotency-Key header.');
      const hash = createHash('sha256').update(`${req.method} ${req.url} ${JSON.stringify(req.body ?? null)}`).digest('hex');
      const ins = await tx.query('INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [user.id, key, hash]);
      if (!ins.rowCount) {
        const prev = (await tx.query('SELECT request_hash, response FROM idempotency_keys WHERE user_id=$1 AND key=$2', [user.id, key])).rows[0];
        if (prev.request_hash !== hash) {
          // Logged outside the transaction so the record survives the rollback.
          await logSuspicious(ctx, user.id, 'idempotency_key_reuse', 'low', { url: req.url });
          throw new AppError(422, 'IDEMPOTENCY_MISMATCH', 'This request key was already used for a different request.');
        }
        return prev.response as T;
      }
      const result = await fn(tx, user);
      await tx.query('UPDATE idempotency_keys SET response=$3 WHERE user_id=$1 AND key=$2', [user.id, key, JSON.stringify(result ?? null)]);
      return result;
    }
    return fn(tx, user);
  });
}

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export type Reply = FastifyReply;

/** Record a risk signal for human review (never an automatic ban). Uses its own connection. */
export async function logSuspicious(ctx: AppContext, userId: string | null, kind: string, severity: 'low' | 'medium' | 'high', details: Record<string, unknown>) {
  await ctx.db
    .query('INSERT INTO suspicious_events (user_id, kind, severity, details, created_at) VALUES ($1,$2,$3,$4,$5)', [userId, kind, severity, JSON.stringify(details), new Date(ctx.now())])
    .catch(() => undefined);
}
