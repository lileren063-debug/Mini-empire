import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TROOP_TYPES } from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import { withTx } from '../db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { limit, mutation, parse, requireUser } from '../lib/http.js';
import { attackPlayer, attackPve, pveStatus, pvpCandidates } from '../services/battles.js';

export const deploymentsSchema = z
  .array(z.object({ troop: z.enum(TROOP_TYPES), count: z.number().int().min(1).max(200), side: z.enum(['north', 'south', 'east', 'west']) }))
  .min(1)
  .max(12);

export async function battleRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/battles/pve', async (req) => {
    const user = requireUser(req);
    return { stages: await withTx(ctx.db, (tx) => pveStatus(ctx, tx, user.id)) };
  });

  app.post('/battles/pve', async (req) => {
    limit(ctx, req, 'battle', 20, 60_000);
    const body = parse(z.object({ stage: z.number().int().min(1).max(100), deployments: deploymentsSchema }), req.body);
    return mutation(ctx, req, (tx, user) => attackPve(ctx, tx, user.id, body.stage, body.deployments));
  });

  app.get('/battles/opponents', async (req) => {
    const user = requireUser(req);
    return { opponents: await withTx(ctx.db, (tx) => pvpCandidates(ctx, tx, user.id)) };
  });

  app.get('/battles/opponents/:id/layout', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { rows } = await ctx.db.query('SELECT b.type, b.level, b.x, b.y FROM buildings b JOIN kingdoms k ON k.id=b.kingdom_id WHERE k.user_id=$1 AND b.level >= 1', [id]);
    return { layout: rows };
  });

  app.post('/battles/pvp', async (req) => {
    limit(ctx, req, 'battle', 20, 60_000);
    const body = parse(z.object({ defenderId: z.string().uuid(), deployments: deploymentsSchema }), req.body);
    return mutation(ctx, req, (tx, user) => attackPlayer(ctx, tx, user.id, body.defenderId, body.deployments));
  });

  app.get('/battles', async (req) => {
    const user = requireUser(req);
    const { rows } = await ctx.db.query(
      `SELECT r.battle_id, r.role, r.summary, r.seen, r.created_at, b.kind, a.username AS attacker, d.username AS defender
         FROM battle_reports r JOIN battles b ON b.id = r.battle_id
         JOIN users a ON a.id = b.attacker_id LEFT JOIN users d ON d.id = b.defender_id
        WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 30`,
      [user.id],
    );
    await ctx.db.query('UPDATE battle_reports SET seen = true WHERE user_id = $1 AND NOT seen', [user.id]);
    return { reports: rows };
  });

  /** Full battle record for replay. Only participants (or staff) can read it. */
  app.get('/battles/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { rows } = await ctx.db.query('SELECT * FROM battles WHERE id = $1', [id]);
    const b = rows[0];
    if (!b) throw notFound('Battle not found');
    if (b.attacker_id !== user.id && b.defender_id !== user.id && user.role === 'player') throw forbidden();
    return { battle: { id: b.id, kind: b.kind, input: b.input, result: b.result, rewards: b.rewards, scorePoints: b.score_points, configVersion: b.config_version, createdAt: b.created_at, pveStage: b.pve_stage, territoryId: b.territory_id } };
  });
}
