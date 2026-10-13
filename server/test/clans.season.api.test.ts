import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { armUp, makeEnv, BOT_TOKEN, type TestEnv } from './env.js';
import { seasonTick, resetSeason } from '../src/services/season.js';
import { distributeRewards } from '../src/services/rewards.js';
import { signTelegramInitData, verifyTelegramInitData } from '../src/auth/telegram.js';

const DAY = 86_400_000;
let env: TestEnv;
beforeAll(async () => {
  env = await makeEnv();
  // Small rosters & low HQ requirement so a test war can run.
  env.setTunables({ clanWar: { minHqLevel: 1, minMembershipHours: 1, minRosterSize: 2 } });
});
afterAll(async () => { await env.close(); });

const emblem = { icon: 'lion', color: '#b91c1c' };
let A: Record<string, { token: string; id: string }> = {};
let clanA = '', clanB = '';

describe('clans', () => {
  it('creates clans, charges the fee and prevents double membership', async () => {
    for (const n of ['lead_a', 'off_a', 'mem_a', 'lead_b', 'mem_b', 'loner']) A[n] = await env.register(n);
    const c = await env.call(A.lead_a.token, 'POST', '/api/clans', { name: 'Iron Lions', tag: 'iron', emblem });
    expect(c.status).toBe(200);
    clanA = c.body.clanId;
    expect((await env.call(A.lead_a.token, 'GET', '/api/kingdom')).body.resources.gold).toBe(500);
    const dupTag = await env.call(A.lead_b.token, 'POST', '/api/clans', { name: 'Other', tag: 'IRON', emblem });
    expect(dupTag.status).toBe(409);
    const b = await env.call(A.lead_b.token, 'POST', '/api/clans', { name: 'Storm Eagles', tag: 'STRM', emblem: { icon: 'eagle', color: '#1d4ed8' } });
    clanB = b.body.clanId;
    for (const n of ['off_a', 'mem_a']) expect((await env.call(A[n].token, 'POST', `/api/clans/${clanA}/join`)).body.status).toBe('joined');
    expect((await env.call(A.mem_b.token, 'POST', `/api/clans/${clanB}/join`)).body.status).toBe('joined');
    // Already in a clan: cannot join another.
    expect((await env.call(A.mem_a.token, 'POST', `/api/clans/${clanB}/join`)).status).toBe(409);
    const rows = await env.sql('SELECT count(*)::int AS n FROM clan_memberships WHERE user_id=$1', [A.mem_a.id]);
    expect(rows[0].n).toBe(1);
  });

  it('enforces role permissions', async () => {
    // Members cannot promote, kick or change settings.
    expect((await env.call(A.mem_a.token, 'POST', `/api/clans/members/${A.off_a.id}/role`, { role: 'officer' })).status).toBe(403);
    expect((await env.call(A.mem_a.token, 'POST', `/api/clans/members/${A.off_a.id}/kick`)).status).toBe(403);
    expect((await env.call(A.mem_a.token, 'PUT', '/api/clans/settings', { description: 'pwned' })).status).toBe(403);
    // Leader promotes; officer still cannot promote or kick another officer / the leader.
    expect((await env.call(A.lead_a.token, 'POST', `/api/clans/members/${A.off_a.id}/role`, { role: 'officer' })).status).toBe(200);
    expect((await env.call(A.off_a.token, 'POST', `/api/clans/members/${A.mem_a.id}/role`, { role: 'officer' })).status).toBe(403);
    expect((await env.call(A.off_a.token, 'POST', `/api/clans/members/${A.lead_a.id}/kick`)).status).toBe(403);
    // Leader of another clan cannot touch this clan's members.
    expect((await env.call(A.lead_b.token, 'POST', `/api/clans/members/${A.mem_a.id}/kick`)).status).toBe(404);
    // Leader cannot leave without transferring.
    expect((await env.call(A.lead_a.token, 'POST', '/api/clans/leave')).body.error.code).toBe('LEADER_MUST_TRANSFER');
    // Officer edits settings; chat works for members only.
    expect((await env.call(A.off_a.token, 'PUT', '/api/clans/settings', { description: 'We hold the line' })).status).toBe(200);
    expect((await env.call(A.mem_a.token, 'POST', '/api/clans/chat', { body: 'hello clan' })).status).toBe(200);
    expect((await env.call(A.loner.token, 'GET', '/api/clans/chat')).status).toBe(400);
    const chat = (await env.call(A.lead_a.token, 'GET', '/api/clans/chat')).body.messages;
    expect(chat[0].body).toBe('hello clan');
  });

  it('closed clans use join requests approved by officers', async () => {
    await env.call(A.lead_b.token, 'PUT', '/api/clans/settings', { joinPolicy: 'closed' });
    expect((await env.call(A.loner.token, 'POST', `/api/clans/${clanB}/join`)).body.status).toBe('requested');
    expect((await env.call(A.mem_b.token, 'POST', `/api/clans/requests/${A.loner.id}/approve`)).status).toBe(403);
    expect((await env.call(A.lead_b.token, 'POST', `/api/clans/requests/${A.loner.id}/approve`)).body.status).toBe('approved');
  });
});

describe('season, war and territories', () => {
  it('roster selection, lock at war start, matchmaking and war battles', async () => {
    // Members need some army and tenure.
    await env.sql('UPDATE resource_balances SET gold=1500');
    for (const n of ['lead_a', 'mem_a', 'lead_b', 'mem_b']) await armUp(env, A[n].token, 20);
    expect((await env.call(A.mem_a.token, 'PUT', '/api/clans/war/roster', { userIds: [A.mem_a.id] })).status).toBe(403);
    expect((await env.call(A.lead_a.token, 'PUT', '/api/clans/war/roster', { userIds: [A.lead_a.id, A.mem_a.id] })).status).toBe(200);
    expect((await env.call(A.lead_b.token, 'PUT', '/api/clans/war/roster', { userIds: [A.lead_b.id, A.mem_b.id] })).status).toBe(200);
    expect((await env.call(A.lead_a.token, 'PUT', '/api/clans/war/roster', { userIds: [A.lead_b.id] })).body.error.code).toBe('NOT_A_MEMBER');

    // Jump to day 94: DEVELOPMENT -> WAR_PREPARATION -> WAR_ACTIVE in order.
    env.clock.now = Date.UTC(2026, 0, 1, 12) + 93 * DAY + 1000;
    expect(await seasonTick(env.ctx)).toEqual(['WAR_PREPARATION', 'WAR_ACTIVE']);
    expect(await seasonTick(env.ctx)).toEqual([]);
    const locked = await env.call(A.lead_a.token, 'PUT', '/api/clans/war/roster', { userIds: [A.lead_a.id] });
    expect(locked.status).toBe(409);
    const war = (await env.call(A.mem_a.token, 'GET', '/api/clans/war')).body.war;
    expect(war.opponent.id).toBe(clanB);
    expect(war.attacksLeft).toBe(3);
    // Off-roster players cannot attack; roster players can, within the limit.
    const r = await env.call(A.mem_a.token, 'POST', '/api/clans/war/attack', { defenderId: A.mem_b.id, deployments: [{ troop: 'infantry', count: 20, side: 'north' }] });
    expect(r.status).toBe(200);
    expect((await env.call(A.off_a.token, 'POST', '/api/clans/war/attack', { defenderId: A.mem_b.id, deployments: [{ troop: 'infantry', count: 1, side: 'north' }] })).body.error.code).toBe('NOT_ON_ROSTER');
    expect((await env.call(A.mem_a.token, 'POST', '/api/clans/war/attack', { defenderId: A.off_a.id, deployments: [{ troop: 'infantry', count: 1, side: 'north' }] })).body.error.code).toBe('NOT_ENEMY');
  });

  it('territory capture during the war phase', async () => {
    await env.sql("UPDATE kingdoms SET hq_level=3 WHERE user_id=$1", [A.lead_a.id]);
    await env.sql("UPDATE buildings SET level=3 WHERE type='headquarters' AND kingdom_id=(SELECT id FROM kingdoms WHERE user_id=$1)", [A.lead_a.id]);
    await env.sql("UPDATE troops SET count=60 WHERE troop_type='infantry' AND kingdom_id=(SELECT id FROM kingdoms WHERE user_id=$1)", [A.lead_a.id]);
    env.clock.advance(10_000);
    const world = (await env.call(A.lead_a.token, 'GET', '/api/world')).body;
    expect(world.attacksOpen).toBe(true);
    expect(world.territories.length).toBeGreaterThanOrEqual(10);
    const r = await env.call(A.lead_a.token, 'POST', '/api/world/territories/t01/attack', { deployments: [{ troop: 'infantry', count: 60, side: 'south' }] });
    expect(r.status).toBe(200);
    const t = (await env.call(A.lead_a.token, 'GET', '/api/world')).body.territories.find((x: any) => x.id === 't01');
    if (r.body.result.stars >= 2) {
      expect(t.ownerClanId).toBe(clanA);
      expect(t.status).toBe('protected');
    } else {
      expect(t.ownerClanId).toBeNull();
    }
  });

  it('war phase end finalizes wars, snapshots leaderboards and freezes scores', async () => {
    env.clock.now = Date.UTC(2026, 0, 1, 12) + 98 * DAY + 1000; // day 99
    expect(await seasonTick(env.ctx)).toEqual(['RESULT_VERIFICATION']);
    const wars = await env.sql('SELECT status, outcome FROM clan_wars');
    expect(wars[0].status).toBe('finished');
    const snaps = await env.sql("SELECT board FROM leaderboard_snapshots WHERE reason='final' ORDER BY board");
    expect(snaps.map((s) => s.board)).toEqual(['clan', 'individual', 'participation']);
    const board = (await env.call(A.lead_a.token, 'GET', '/api/leaderboards/clan')).body;
    expect(board.entries.length).toBeGreaterThan(0);
    // Scores are frozen outside the competitive phases.
    const before = await env.sql("SELECT count(*)::int AS n FROM score_events");
    await env.call(A.loner.token, 'POST', '/api/kingdom/buildings', { type: 'wall', x: 2, y: 2 });
    const after = await env.sql("SELECT count(*)::int AS n FROM score_events");
    expect(after[0].n).toBe(before[0].n);
    // Invalid transitions are refused.
    const adminCheck = await env.call(A.lead_a.token, 'POST', '/api/admin/season/transition', { to: 'DEVELOPMENT', reason: 'try to rewind' });
    expect(adminCheck.status).toBe(403);
  });

  it('reward preview/approve/distribute never pays twice; reset is atomic, idempotent and preserves permanent data', async () => {
    await env.sql("UPDATE users SET role='superadmin' WHERE id=$1", [A.loner.id]);
    // Give everyone HQ 3 in the participant records so they are eligible.
    await env.sql('UPDATE season_participants SET hq_level=3, participation_score=50');
    const prev = await env.call(A.loner.token, 'POST', '/api/admin/rewards/preview', { poolTokens: 1000 });
    expect(prev.status).toBe(200);
    expect(prev.body.lines).toBeGreaterThan(0);
    expect(BigInt(prev.body.undistributed)).toBeGreaterThanOrEqual(0n);
    const appr = await env.call(A.loner.token, 'POST', '/api/admin/rewards/approve');
    expect(appr.status).toBe(200);
    expect(appr.body.completed).toBe(prev.body.lines);
    const total1 = (await env.sql('SELECT COALESCE(sum(units),0)::text AS u FROM token_balances'))[0].u;
    // Approving again or re-running distribution does not pay twice.
    expect((await env.call(A.loner.token, 'POST', '/api/admin/rewards/approve')).status).toBe(409);
    const pool = (await env.sql('SELECT id FROM reward_pools'))[0].id;
    await distributeRewards(env.ctx, pool);
    await env.call(A.loner.token, 'POST', '/api/admin/rewards/retry');
    const total2 = (await env.sql('SELECT COALESCE(sum(units),0)::text AS u FROM token_balances'))[0].u;
    expect(total2).toBe(total1);
    expect(BigInt(total1)).toBeLessThanOrEqual(1000n * 1_000_000n);

    const achievementsBefore = (await env.sql('SELECT count(*)::int AS n FROM achievements'))[0].n;
    const cosmeticsBefore = (await env.sql('SELECT count(*)::int AS n FROM cosmetic_inventory'))[0].n;
    const clanEventsBefore = (await env.sql('SELECT count(*)::int AS n FROM clan_events'))[0].n;
    // Wrong confirmation text is rejected.
    expect((await env.call(A.loner.token, 'POST', '/api/admin/season/reset', { confirm: 'yes' })).status).toBe(400);
    const reset = await env.call(A.loner.token, 'POST', '/api/admin/season/reset', { confirm: 'RESET SEASON 1' });
    expect(reset.status).toBe(200);
    expect(reset.body.alreadyReset).toBe(false);
    // Second run is a no-op.
    expect((await resetSeason(env.ctx, null)).alreadyReset).toBe(true);

    // Seasonal data reset.
    const k = (await env.call(A.lead_a.token, 'GET', '/api/kingdom')).body;
    expect(k.buildings.map((b: any) => `${b.type}:${b.level}`).sort()).toEqual(['archer_tower:1', 'headquarters:1', 'wall:1']);
    expect(k.troops.infantry).toBe(0);
    expect(k.resources).toEqual({ gold: 1500, wood: 1500, stone: 500 });
    const territories = await env.sql('SELECT count(*)::int AS n FROM territories WHERE owner_clan_id IS NOT NULL');
    expect(territories[0].n).toBe(0);
    // Permanent data preserved.
    expect((await env.sql('SELECT sum(units)::text AS u FROM token_balances'))[0].u).toBe(total1);
    expect((await env.sql('SELECT count(*)::int AS n FROM achievements'))[0].n).toBeGreaterThanOrEqual(achievementsBefore);
    expect((await env.sql('SELECT count(*)::int AS n FROM cosmetic_inventory'))[0].n).toBeGreaterThanOrEqual(cosmeticsBefore);
    expect((await env.sql('SELECT count(*)::int AS n FROM clan_events'))[0].n).toBeGreaterThanOrEqual(clanEventsBefore);
    expect((await env.sql('SELECT count(*)::int AS n FROM users'))[0].n).toBe(6);
    expect((await env.sql('SELECT count(*)::int AS n FROM clan_memberships'))[0].n).toBe(6);
    expect((await env.sql('SELECT count(*)::int AS n FROM season_archives WHERE season_id=1'))[0].n).toBe(6);
    expect((await env.sql("SELECT count(*)::int AS n FROM leaderboard_snapshots WHERE season_id=1 AND reason='final'"))[0].n).toBe(3);
    const seasons = await env.sql('SELECT number, state FROM seasons ORDER BY number');
    expect(seasons).toEqual([{ number: 1, state: 'COMPLETED' }, { number: 2, state: 'DEVELOPMENT' }]);
    const profile = (await env.call(A.lead_a.token, 'GET', '/api/profile/me')).body;
    expect(profile.seasonHistory[0].number).toBe(1);
    expect(Number(profile.testTokenBalance)).toBeGreaterThanOrEqual(0);
  });
});

describe('telegram identity', () => {
  it('accepts only correctly signed, fresh initData', async () => {
    const now = Date.UTC(2026, 0, 1);
    const fields = { auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id: 4242, username: 'tg_hero' }) };
    const good = signTelegramInitData(fields, BOT_TOKEN);
    expect(verifyTelegramInitData(good, BOT_TOKEN, now)?.id).toBe(4242);
    expect(verifyTelegramInitData(good, 'other:token', now)).toBeNull();
    expect(verifyTelegramInitData(good.replace('4242', '4243'), BOT_TOKEN, now)).toBeNull();
    expect(verifyTelegramInitData(good, BOT_TOKEN, now + 2 * DAY)).toBeNull();
    env.clock.now = now;
    const login = await env.call(null, 'POST', '/api/auth/telegram', { initData: good });
    expect(login.status).toBe(200);
    expect(login.body.user.username).toBe('tg_hero');
    const forged = await env.call(null, 'POST', '/api/auth/telegram', { initData: good.replace('tg_hero', 'admin') });
    expect(forged.status).toBe(401);
  });
});

describe('telegram bot webhook', () => {
  it('rejects requests without the secret and answers /start with a Mini App button', async () => {
    const { buildApp } = await import('../src/app.js');
    const { webhookSecret } = await import('../src/telegramBot.js');
    const calls: { url: string; body: any }[] = [];
    const fetchFn = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return { json: async () => ({ ok: true }) }; }) as any;
    const app = await buildApp(env.ctx, { bot: { publicUrl: 'https://game.example.com', fetchFn } });
    await app.ready();
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['setWebhook', 'setChatMenuButton']);
    const update = { message: { chat: { id: 42 }, text: '/start' } };
    expect((await app.inject({ method: 'POST', url: '/api/telegram/webhook', payload: update })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/telegram/webhook', payload: update, headers: { 'x-telegram-bot-api-secret-token': webhookSecret(BOT_TOKEN) } });
    expect(ok.statusCode).toBe(200);
    const send = calls.find((c) => c.url.endsWith('/sendMessage'))!;
    expect(send.body.chat_id).toBe(42);
    expect(send.body.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://game.example.com');
    await app.close();
  });
});
