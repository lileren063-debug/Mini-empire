import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTx } from '../db.js';
import { limit, mutation, parse, requireUser } from '../lib/http.js';
import { attackTerritory, territoryHistory, worldMap } from '../services/territories.js';
import { deploymentsSchema } from './battles.js';

export async function worldRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/world', async (req) => {
    const user = requireUser(req);
    return withTx(ctx.db, (tx) => worldMap(ctx, tx, user.id));
  });
  app.get('/world/territories/:id/history', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: z.string().max(10) }), req.params);
    return withTx(ctx.db, (tx) => territoryHistory(tx, id));
  });
  app.post('/world/territories/:id/attack', async (req) => {
    limit(ctx, req, 'battle', 20, 60_000);
    const { id } = parse(z.object({ id: z.string().max(10) }), req.params);
    const body = parse(z.object({ deployments: deploymentsSchema }), req.body);
    return mutation(ctx, req, (tx, user) => attackTerritory(ctx, tx, user.id, id, body.deployments));
  });
}
