import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simulateBattle, DEFAULT_CONFIG } from '@mini-empire/shared';
import { armUp, makeEnv, type TestEnv } from './env.js';

let env: TestEnv;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.close(); });

describe('PvE battles', () => {
  it('server resolves the battle, applies casualties and grants validated rewards', async () => {
    const { token } = await env.register('knight');
    const before = await armUp(env, token, 20);
    expect(before.troops.infantry).toBe(20);
    const r = await env.call(token, 'POST', '/api/battles/pve', { stage: 1, deployments: [{ troop: 'infantry', count: 20, side: 'south' }] });
    expect(r.status).toBe(200);
    expect(r.body.result.victory).toBe(true);
    expect(r.body.rewards.gold).toBeGreaterThan(0);
    const after = (await env.call(token, 'GET', '/api/kingdom')).body;
    expect(after.troops.infantry).toBe(20 - r.body.result.casualties.infantry);
    expect(after.resources.gold).toBe(Math.min(after.storageCapacity, before.resources.gold + r.body.rewards.gold));
    // The stored battle can be replayed deterministically from its recorded inputs.
    const stored = (await env.call(token, 'GET', `/api/battles/${r.body.battleId}`)).body.battle;
    expect(simulateBattle(stored.input, DEFAULT_CONFIG).result).toEqual(stored.result);
  });

  it('a client cannot fake a victory, rewards or troops', async () => {
    const { token } = await env.register('cheater');
    await armUp(env, token, 3);
    const k0 = (await env.call(token, 'GET', '/api/kingdom')).body;
    // Extra fields claiming a result are ignored; the server simulates.
    const r = await env.call(token, 'POST', '/api/battles/pve', {
      stage: 1, deployments: [{ troop: 'infantry', count: 3, side: 'north' }],
      victory: true, stars: 3, rewards: { gold: 999999 }, result: { victory: true },
    });
    expect(r.status).toBe(200);
    expect(r.body.rewards.gold).toBeLessThan(5000);
    // Deploying troops you do not have is refused.
    env.clock.advance(10_000);
    const ghost = await env.call(token, 'POST', '/api/battles/pve', { stage: 1, deployments: [{ troop: 'infantry', count: 500, side: 'north' }] });
    expect(ghost.status).toBe(400);
    const ghost2 = await env.call(token, 'POST', '/api/battles/pve', { stage: 1, deployments: [{ troop: 'cavalry', count: 1, side: 'north' }] });
    expect(ghost2.body.error.code).toBe('NOT_ENOUGH_TROOPS');
    // Locked stages cannot be attacked.
    const locked = await env.call(token, 'POST', '/api/battles/pve', { stage: 9, deployments: [{ troop: 'infantry', count: 1, side: 'north' }] });
    expect(locked.body.error.code).toBe('STAGE_LOCKED');
    // There is no endpoint to submit results or add resources.
    expect((await env.call(token, 'POST', '/api/battles/result', { victory: true })).status).toBe(404);
    expect((await env.call(token, 'POST', '/api/kingdom/resources', { gold: 1e6 })).status).toBe(404);
    const k1 = (await env.call(token, 'GET', '/api/kingdom')).body;
    expect(k1.resources.gold).toBeLessThanOrEqual(k0.resources.gold + 5000);
  });

  it('rewards stop after the daily attempt limit', async () => {
    const { token } = await env.register('farmer');
    await armUp(env, token, 20);
    const rewards: number[] = [];
    for (let i = 0; i < 4; i++) {
      env.clock.advance(10_000);
      const r = await env.call(token, 'POST', '/api/battles/pve', { stage: 1, deployments: [{ troop: 'infantry', count: 2, side: 'north' }] });
      expect(r.status).toBe(200);
      rewards.push(r.body.scorePoints + r.body.rewards.gold);
    }
    expect(rewards[3]).toBe(0);
  });
});

describe('PvP battles', () => {
  it('loots the defender, shields them, records reports and limits repeat attacks', async () => {
    const att = await env.register('raider');
    const def = await env.register('victim');
    await armUp(env, att.token, 20);
    const opp = (await env.call(att.token, 'GET', '/api/battles/opponents')).body.opponents;
    expect(opp.some((o: any) => o.id === def.id)).toBe(true);
    const defBefore = (await env.call(def.token, 'GET', '/api/kingdom')).body.resources;
    env.clock.advance(10_000);
    const r = await env.call(att.token, 'POST', '/api/battles/pvp', { defenderId: def.id, deployments: [{ troop: 'infantry', count: 20, side: 'west' }] });
    expect(r.status).toBe(200);
    const defAfter = (await env.call(def.token, 'GET', '/api/kingdom')).body.resources;
    expect(defBefore.gold - defAfter.gold).toBe(r.body.rewards.gold);
    const reports = (await env.call(def.token, 'GET', '/api/battles')).body.reports;
    expect(reports[0].role).toBe('defender');
    // Shielded now.
    env.clock.advance(10_000);
    const again = await env.call(att.token, 'POST', '/api/battles/pvp', { defenderId: def.id, deployments: [{ troop: 'infantry', count: 1, side: 'west' }] });
    expect(again.body.error.code).toBe('SHIELDED');
    // Self attack refused.
    const self = await env.call(att.token, 'POST', '/api/battles/pvp', { defenderId: att.id, deployments: [{ troop: 'infantry', count: 1, side: 'west' }] });
    expect(self.body.error.code).toBe('SELF_ATTACK');
    // Other players cannot read this battle.
    const other = await env.register('snoop');
    expect((await env.call(other.token, 'GET', `/api/battles/${r.body.battleId}`)).status).toBe(403);
  });
});

describe('missions', () => {
  it('progress comes from server events and a reward can only be claimed once', async () => {
    const { token } = await env.register('quester');
    // Not complete yet.
    expect((await env.call(token, 'POST', '/api/missions/d_upgrade/claim')).body.error.code).toBe('NOT_COMPLETE');
    await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'wall', x: 2, y: 2 }); // instant construction
    const list = (await env.call(token, 'GET', '/api/missions')).body.missions;
    expect(list.find((m: any) => m.id === 'd_upgrade').progress).toBe(1);
    // Fire concurrent claims: exactly one succeeds.
    const claims = await Promise.all([1, 2, 3].map(() => env.call(token, 'POST', '/api/missions/d_upgrade/claim')));
    expect(claims.filter((c) => c.status === 200)).toHaveLength(1);
    expect(claims.filter((c) => c.status === 409 || c.status === 400).length).toBe(2);
    const again = await env.call(token, 'POST', '/api/missions/d_upgrade/claim');
    expect(again.body.error.code).toBe('ALREADY_CLAIMED');
    // Next UTC day: a fresh mission period.
    env.clock.advance(24 * 3_600_000);
    const next = (await env.call(token, 'GET', '/api/missions')).body.missions.find((m: any) => m.id === 'd_upgrade');
    expect(next.progress).toBe(0);
    expect(next.claimed).toBe(false);
  });

  it('participation score is capped per day', async () => {
    const { token, id } = await env.register('grinder');
    await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'wall', x: 2, y: 2 });
    await env.call(token, 'POST', '/api/missions/d_upgrade/claim');
    const rows = await env.sql("SELECT COALESCE(sum(points),0)::int AS p FROM score_events WHERE user_id=$1 AND category='participation'", [id]);
    expect(rows[0].p).toBeLessThanOrEqual(40);
    expect(rows[0].p).toBe(10); // active day (5) + mission (5)
  });
});
