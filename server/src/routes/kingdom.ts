import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BUILDING_TYPES, TROOP_TYPES, armyCapacity, builderCount, cancelTraining, cancelUpgrade, collect, enqueueTraining, hqLevel,
  housingUsed, moveBuilding, placeBuilding, producedAmount, startUpgrade, storageCapacity, troopMultiplier, type KingdomState,
} from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import { withTx } from '../db.js';
import { limit, mutation, parse, requireUser } from '../lib/http.js';
import { withKingdom } from '../services/kingdomService.js';

export function kingdomView(ctx: AppContext, state: KingdomState, now: number, extra: Record<string, unknown> = {}) {
  return {
    serverTime: now,
    configVersion: ctx.cfg.version,
    resources: state.resources,
    storageCapacity: storageCapacity(state, ctx.cfg),
    hqLevel: hqLevel(state),
    builders: builderCount(state, ctx.cfg),
    buildings: state.buildings.map((b) => ({ ...b, produced: Math.floor(producedAmount(b, now, ctx.cfg)) })),
    troops: state.troops,
    trainingQueue: state.trainingQueue,
    armyCapacity: armyCapacity(state, ctx.cfg),
    housingUsed: housingUsed(state, ctx.cfg),
    troopMultiplier: troopMultiplier(state),
    ...extra,
  };
}

const coord = z.number().int().min(0).max(63);

export async function kingdomRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/config', async () => ctx.cfg);

  app.get('/kingdom', async (req) => {
    const user = requireUser(req);
    // Viewing also settles finished timers, inside a locked transaction (exactly-once completion).
    const r = await withTx(ctx.db, (tx) => withKingdom(ctx, tx, user.id, 'view', () => ({ result: null })));
    return kingdomView(ctx, r.state, ctx.now(), { shieldUntil: r.kingdom.shieldUntil });
  });

  app.post('/kingdom/buildings', async (req) => {
    limit(ctx, req, 'kingdom', 120, 60_000);
    const body = parse(z.object({ type: z.enum(BUILDING_TYPES), x: coord, y: coord }), req.body);
    return mutation(ctx, req, async (tx, user) => {
      const r = await withKingdom(ctx, tx, user.id, 'build', (s, rc) => {
        const { building, events } = placeBuilding(s, rc, body.type, body.x, body.y);
        return { result: building, events, ref: building.id };
      });
      return kingdomView(ctx, r.state, ctx.now(), { building: r.result });
    });
  });

  app.post('/kingdom/buildings/:id/upgrade', async (req) => {
    limit(ctx, req, 'kingdom', 120, 60_000);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return mutation(ctx, req, async (tx, user) => {
      const r = await withKingdom(ctx, tx, user.id, 'upgrade', (s, rc) => {
        const out = startUpgrade(s, rc, id);
        return { result: out.building, events: out.events, ref: id };
      });
      return kingdomView(ctx, r.state, ctx.now());
    });
  });

  app.post('/kingdom/buildings/:id/cancel', async (req) => {
    limit(ctx, req, 'kingdom', 120, 60_000);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return mutation(ctx, req, async (tx, user) => {
      const r = await withKingdom(ctx, tx, user.id, 'cancel_upgrade', (s, rc) => ({ result: cancelUpgrade(s, rc, id), ref: id }));
      return kingdomView(ctx, r.state, ctx.now(), { refund: r.result.refund });
    });
  });

  app.post('/kingdom/buildings/:id/move', async (req) => {
    limit(ctx, req, 'kingdom', 120, 60_000);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(z.object({ x: coord, y: coord }), req.body);
    return mutation(ctx, req, async (tx, user) => {
      const r = await withKingdom(ctx, tx, user.id, 'move', (s, rc) => ({ result: moveBuilding(s, rc, id, body.x, body.y) }));
      return kingdomView(ctx, r.state, ctx.now());
    });
  });

  app.post('/kingdom/collect', async (req) => {
    limit(ctx, req, 'collect', 60, 60_000);
    const body = parse(z.object({ buildingId: z.string().uuid().optional() }), req.body);
    return mutation(ctx, req, async (tx, user) => {
      const r = await withKingdom(ctx, tx, user.id, 'collect', (s, rc) => {
        const out = collect(s, rc, body.buildingId);
        return { result: out.collected, events: out.events, ref: body.buildingId };
      });
      return kingdomView(ctx, r.state, ctx.now(), { collected: r.result });
    });
  });

  app.post('/army/train', async (req) => {
    limit(ctx, req, 'kingdom', 120, 60_000);
    const body = parse(z.object({ troop: z.enum(TROOP_TYPES), count: z.number().int().min(1).max(100) }), req.body);
    return mutation(ctx, req, async (tx, user) => {
      const r = await withKingdom(ctx, tx, user.id, 'train', (s, rc) => {
        const out = enqueueTraining(s, rc, body.troop, body.count);
        return { result: null, events: out.events };
      });
      return kingdomView(ctx, r.state, ctx.now());
    });
  });

  app.post('/army/train/:id/cancel', async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return mutation(ctx, req, async (tx, user) => {
      const r = await withKingdom(ctx, tx, user.id, 'cancel_training', (s, rc) => ({ result: cancelTraining(s, rc, id, storageCapacity(s, ctx.cfg)), ref: id }));
      return kingdomView(ctx, r.state, ctx.now(), { refund: r.result.refund });
    });
  });

  app.get('/kingdom/transactions', async (req) => {
    const user = requireUser(req);
    const { rows } = await ctx.db.query(
      'SELECT delta_gold, delta_wood, delta_stone, gold_after, wood_after, stone_after, reason, created_at FROM resource_transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 50',
      [user.id],
    );
    return { transactions: rows };
  });
}
