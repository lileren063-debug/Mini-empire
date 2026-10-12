import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeEnv, type TestEnv } from './env.js';

let env: TestEnv;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.close(); });

describe('accounts & authorization', () => {
  it('rejects unauthenticated and unauthorized requests', async () => {
    expect((await env.call(null, 'GET', '/api/kingdom')).status).toBe(401);
    expect((await env.call('garbage-token', 'GET', '/api/kingdom')).status).toBe(401);
    const { token } = await env.register('plainplayer');
    expect((await env.call(token, 'GET', '/api/admin/overview')).status).toBe(403);
    expect((await env.call(token, 'PUT', '/api/admin/config', { tunables: { productionMultiplier: 10 }, note: 'hack' })).status).toBe(403);
    expect((await env.call(token, 'POST', '/api/admin/season/reset', { confirm: 'RESET SEASON 1' })).status).toBe(403);
  });
  it('rejects duplicate usernames and bad passwords', async () => {
    await env.register('dupe');
    const r = await env.call(null, 'POST', '/api/auth/register', { username: 'DUPE', password: 'whatever123' }, { 'x-forwarded-for': '9.9.9.9' });
    expect(r.status).toBe(409);
    const l = await env.call(null, 'POST', '/api/auth/login', { username: 'dupe', password: 'wrong-password' });
    expect(l.status).toBe(401);
    const ok = await env.call(null, 'POST', '/api/auth/login', { username: 'dupe', password: 'correct-horse-battery' });
    expect(ok.status).toBe(200);
  });
  it('public profiles do not leak private data', async () => {
    const a = await env.register('privacy');
    const b = await env.register('viewer');
    const r = await env.call(b.token, 'GET', `/api/profile/${a.id}`);
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/password|ip_hash|telegram|under_review|suspended/i);
    expect(r.body.username).toBe('privacy');
  });
});

describe('kingdom over the API', () => {
  it('new players start with exactly HQ 1, a tower and a wall', async () => {
    const { token } = await env.register('starter');
    const k = (await env.call(token, 'GET', '/api/kingdom')).body;
    expect(k.buildings.map((b: any) => `${b.type}:${b.level}`).sort()).toEqual(['archer_tower:1', 'headquarters:1', 'wall:1']);
    expect(k.resources).toEqual({ gold: 1500, wood: 1500, stone: 500 });
  });

  it('validates placement and deducts costs atomically', async () => {
    const { token } = await env.register('builder');
    const bad = await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'gold_mine', x: 11, y: 11 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('OVERLAP');
    const k0 = (await env.call(token, 'GET', '/api/kingdom')).body;
    expect(k0.resources.gold).toBe(1500);
    const ok = await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'gold_mine', x: 3, y: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body.resources.gold).toBe(1400);
    const tx = (await env.call(token, 'GET', '/api/kingdom/transactions')).body.transactions;
    expect(tx[0]).toMatchObject({ reason: 'build', delta_gold: -100, delta_wood: -250 });
  });

  it('cannot finish an upgrade early or without resources', async () => {
    const { token } = await env.register('upgrader');
    const k = (await env.call(token, 'GET', '/api/kingdom')).body;
    const hq = k.buildings.find((b: any) => b.type === 'headquarters');
    const up = await env.call(token, 'POST', `/api/kingdom/buildings/${hq.id}/upgrade`);
    expect(up.status).toBe(200);
    const busy = (await env.call(token, 'GET', '/api/kingdom')).body.buildings.find((b: any) => b.id === hq.id);
    expect(busy.level).toBe(1);
    expect(busy.upgrade.toLevel).toBe(2);
    env.clock.advance(60_000); // 1 of 5 minutes
    expect((await env.call(token, 'GET', '/api/kingdom')).body.hqLevel).toBe(1);
    env.clock.advance(5 * 60_000);
    expect((await env.call(token, 'GET', '/api/kingdom')).body.hqLevel).toBe(2);
    // Out of resources now: next upgrade is refused and nothing is charged.
    await env.sql("UPDATE resource_balances SET gold=10, wood=10, stone=10 WHERE kingdom_id=(SELECT id FROM kingdoms WHERE user_id=(SELECT id FROM users WHERE username='upgrader'))");
    const tower = k.buildings.find((b: any) => b.type === 'archer_tower');
    const r = await env.call(token, 'POST', `/api/kingdom/buildings/${tower.id}/upgrade`);
    expect(r.body.error.code).toBe('INSUFFICIENT_RESOURCES');
    expect((await env.call(token, 'GET', '/api/kingdom')).body.resources).toEqual({ gold: 10, wood: 10, stone: 10 });
  });

  it('offline production uses server time, respects storage and cannot be collected twice', async () => {
    const { token } = await env.register('miner');
    const placed = await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'gold_mine', x: 3, y: 3 });
    env.clock.advance(10_000);
    const goldBefore = (await env.call(token, 'GET', '/api/kingdom')).body.resources.gold;
    env.clock.advance(2 * 3_600_000);
    // Fire several collects concurrently: total credited must equal exactly one collection.
    const results = await Promise.all([1, 2, 3, 4].map(() => env.call(token, 'POST', '/api/kingdom/collect', {})));
    const total = results.reduce((a, r) => a + (r.body.collected?.gold ?? 0), 0);
    expect(total).toBe(300); // 150/h * 2h
    const k = (await env.call(token, 'GET', '/api/kingdom')).body;
    expect(k.resources.gold).toBe(goldBefore + 300);
    // Way past the buffer: production is capped, and capped again by storage space.
    env.clock.advance(100 * 3_600_000);
    const big = await env.call(token, 'POST', '/api/kingdom/collect', { buildingId: placed.body.building.id });
    expect(big.body.resources.gold).toBeLessThanOrEqual(big.body.storageCapacity);
    expect(big.body.collected.gold).toBe(Math.min(1500, big.body.storageCapacity - k.resources.gold));
  });

  it('idempotency keys prevent double execution and reject reuse with another body', async () => {
    const { token } = await env.register('idem');
    const h = { 'idempotency-key': 'build-wall-0001' };
    const a = await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'wall', x: 2, y: 2 }, h);
    const b = await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'wall', x: 2, y: 2 }, h);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.resources).toEqual(a.body.resources);
    const k = (await env.call(token, 'GET', '/api/kingdom')).body;
    expect(k.buildings.filter((x: any) => x.type === 'wall')).toHaveLength(2);
    const c = await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'wall', x: 5, y: 2 }, h);
    expect(c.status).toBe(422);
  });

  it('training queue charges, delivers over time and refunds on cancel', async () => {
    const { token } = await env.register('trainer');
    await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'barracks', x: 3, y: 3 });
    env.clock.advance(15_000);
    const t = await env.call(token, 'POST', '/api/army/train', { troop: 'infantry', count: 5 });
    expect(t.status).toBe(200);
    expect(t.body.trainingQueue).toHaveLength(1);
    env.clock.advance(41_000);
    const k = (await env.call(token, 'GET', '/api/kingdom')).body;
    expect(k.troops.infantry).toBe(2);
    const cancel = await env.call(token, 'POST', `/api/army/train/${k.trainingQueue[0].id}/cancel`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.refund.gold).toBe(50 + 50 + 25);
    const locked = await env.call(token, 'POST', '/api/army/train', { troop: 'siege', count: 1 });
    expect(locked.body.error.code).toBe('TROOP_LOCKED');
  });

  it('rejects malformed input', async () => {
    const { token } = await env.register('fuzzer');
    expect((await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'castle', x: 1, y: 1 })).status).toBe(400);
    expect((await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'wall', x: -1, y: 1 })).status).toBe(400);
    expect((await env.call(token, 'POST', '/api/army/train', { troop: 'infantry', count: 1e9 })).status).toBe(400);
    expect((await env.call(token, 'POST', '/api/kingdom/buildings/not-a-uuid/upgrade')).status).toBe(400);
  });
});
