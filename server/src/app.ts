import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { GameRuleError } from '@mini-empire/shared';
import type { AppContext } from './context.js';
import { AppError } from './lib/errors.js';
import { resolveSession } from './auth/sessions.js';
import { authRoutes } from './routes/auth.js';
import { kingdomRoutes } from './routes/kingdom.js';
import { battleRoutes } from './routes/battles.js';
import { missionRoutes } from './routes/missions.js';
import { clanRoutes } from './routes/clans.js';
import { worldRoutes } from './routes/world.js';
import { seasonRoutes } from './routes/season.js';
import { profileRoutes } from './routes/profile.js';
import { adminRoutes } from './routes/admin.js';

export async function buildApp(ctx: AppContext, opts: { logger?: boolean; clientDist?: string; corsOrigin?: string } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 64 * 1024, trustProxy: true });

  // Security headers.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    if (opts.corsOrigin) {
      reply.header('Access-Control-Allow-Origin', opts.corsOrigin);
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
  });
  if (opts.corsOrigin) app.options('/api/*', async (_req, reply) => reply.code(204).send());

  // Global per-IP rate limit for the API.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (!ctx.rate.check(`global:${req.ip}`, 600, 60_000)) throw new AppError(429, 'RATE_LIMITED', 'Too many requests.');
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const user = await resolveSession(ctx.db, auth.slice(7), ctx.now());
      if (user && !user.suspended) req.user = user;
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof GameRuleError) return reply.code(400).send({ error: { code: err.code, message: err.message } });
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    const e = err as { statusCode?: number; validation?: unknown; code?: string; message: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: e.code ?? 'BAD_REQUEST', message: e.message } });
    // Unique-constraint races surface as conflicts, not 500s.
    if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: { code: 'CONFLICT', message: 'That conflicts with an existing record. Please retry.' } });
    if ((err as { code?: string }).code === '23514') return reply.code(400).send({ error: { code: 'CONSTRAINT', message: 'That action would break a game rule.' } });
    ctx.errors.push({ at: ctx.now(), message: `${req.method} ${req.url}: ${e.message}` });
    if (ctx.errors.length > 200) ctx.errors.shift();
    ctx.db.query("INSERT INTO error_logs (level, message, context) VALUES ('error', $1, $2)", [e.message, JSON.stringify({ url: req.url, method: req.method })]).catch(() => undefined);
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.' } });
  });

  app.get('/api/health', async () => {
    await ctx.db.query('SELECT 1');
    return { ok: true, time: ctx.now() };
  });

  await app.register(async (api) => {
    await authRoutes(api, ctx);
    await kingdomRoutes(api, ctx);
    await battleRoutes(api, ctx);
    await missionRoutes(api, ctx);
    await clanRoutes(api, ctx);
    await worldRoutes(api, ctx);
    await seasonRoutes(api, ctx);
    await profileRoutes(api, ctx);
    await adminRoutes(api, ctx);
  }, { prefix: '/api' });

  if (opts.clientDist && existsSync(opts.clientDist)) {
    await app.register(fastifyStatic, { root: opts.clientDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint' } });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
