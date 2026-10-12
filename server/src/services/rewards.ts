import { REWARD_ALLOCATION, REWARD_ELIGIBILITY, TOKEN_UNIT, ACHIEVEMENTS, calculateRewards, type RewardCategory } from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import { withTx, type Tx } from '../db.js';
import { AppError } from '../lib/errors.js';
import { audit } from './audit.js';
import { finalSnapshot } from './leaderboards.js';
import { enterRewardDistribution } from './season.js';

/**
 * SIMULATED reward ledger. No blockchain, no real value, no promise of financial return.
 * A real integration must live in a separately reviewed service with proper key management;
 * this module only records what *would* be distributed and credits a test balance.
 */

export async function rewardPreview(ctx: AppContext, actorId: string, input: { poolTokens: number; allocation?: Record<RewardCategory, number> }) {
  const allocation = input.allocation ?? REWARD_ALLOCATION;
  return withTx(ctx.db, async (tx) => {
    const season = (await tx.query("SELECT * FROM seasons WHERE state <> 'COMPLETED' ORDER BY id DESC LIMIT 1 FOR UPDATE")).rows[0];
    if (!season || season.state !== 'RESULT_VERIFICATION') throw new AppError(409, 'NOT_VERIFICATION', 'Rewards can only be previewed during result verification.');
    const pool = (await tx.query('SELECT * FROM reward_pools WHERE season_id=$1 FOR UPDATE', [season.id])).rows[0];
    if (pool && !['draft', 'previewed'].includes(pool.status)) throw new AppError(409, 'POOL_LOCKED', 'Rewards were already approved for this season.');
    const poolUnits = BigInt(Math.round(input.poolTokens)) * BigInt(TOKEN_UNIT);

    // Eligibility: HQ level, not suspended, not under review.
    const eligibleRows = (
      await tx.query(
        `SELECT sp.user_id, sp.hq_level, sp.clan_id, sp.participation_score FROM season_participants sp JOIN users u ON u.id = sp.user_id
          WHERE sp.season_id=$1 AND sp.hq_level >= $2 AND NOT u.suspended AND (NOT $3 OR NOT u.under_review)`,
        [season.id, REWARD_ELIGIBILITY.minHqLevel, REWARD_ELIGIBILITY.excludeUnderReview],
      )
    ).rows;
    const eligible = new Set(eligibleRows.map((r) => r.user_id as string));
    const clanBoard = ((await finalSnapshot(tx, season.id, 'clan')) ?? []).slice(0, REWARD_ELIGIBILITY.clanTopN);
    const indBoard = ((await finalSnapshot(tx, season.id, 'individual')) ?? []).filter((e) => eligible.has(e.id)).slice(0, REWARD_ELIGIBILITY.individualTopN);
    const contributions = (await tx.query('SELECT user_id, clan_id, contribution FROM clan_memberships WHERE contribution > 0')).rows;
    const specialIds = ACHIEVEMENTS.filter((a) => a.special).map((a) => a.id);
    const special = (
      await tx.query(
        `SELECT a.user_id, count(*)::int AS n FROM achievements a
          WHERE a.season_id=$1 AND a.achievement_id = ANY($2)
            AND NOT EXISTS (SELECT 1 FROM suspicious_events s WHERE s.user_id=a.user_id AND s.status='actioned')
          GROUP BY a.user_id`,
        [season.id, specialIds],
      )
    ).rows.filter((r) => eligible.has(r.user_id));

    const result = calculateRewards({
      poolUnits,
      allocation,
      clans: clanBoard.map((c) => ({
        clanId: c.id,
        score: c.score,
        members: contributions.filter((m) => m.clan_id === c.id && eligible.has(m.user_id)).map((m) => ({ userId: m.user_id, contribution: m.contribution })),
      })),
      individuals: indBoard.map((e) => ({ userId: e.id, score: e.score })),
      participants: eligibleRows.filter((r) => r.participation_score >= REWARD_ELIGIBILITY.minParticipationScore).map((r) => ({ userId: r.user_id, score: r.participation_score })),
      special: special.map((s) => ({ userId: s.user_id, weight: s.n })),
    });

    let poolId: number;
    if (pool) {
      poolId = pool.id;
      await tx.query("DELETE FROM reward_allocations WHERE pool_id=$1 AND status='preview'", [poolId]);
      await tx.query("UPDATE reward_pools SET total_units=$2, allocation=$3, status='previewed' WHERE id=$1", [poolId, poolUnits.toString(), JSON.stringify(allocation)]);
    } else {
      poolId = (await tx.query("INSERT INTO reward_pools (season_id, total_units, allocation, status, created_by, created_at) VALUES ($1,$2,$3,'previewed',$4,$5) RETURNING id", [
        season.id, poolUnits.toString(), JSON.stringify(allocation), actorId, new Date(ctx.now()),
      ])).rows[0].id;
    }
    for (const l of result.lines) {
      await tx.query("INSERT INTO reward_allocations (pool_id, user_id, category, units, basis, status, created_at) VALUES ($1,$2,$3,$4,$5,'preview',$6)", [
        poolId, l.userId, l.category, l.units.toString(), l.basis, new Date(ctx.now()),
      ]);
    }
    await audit(tx, actorId, 'rewards.preview', 'reward_pool', String(poolId), { poolTokens: input.poolTokens, allocation, lines: result.lines.length }, ctx.now());
    return {
      poolId,
      lines: result.lines.length,
      categoryTotals: Object.fromEntries(Object.entries(result.categoryTotals).map(([k, v]) => [k, v.toString()])),
      undistributed: result.undistributed.toString(),
    };
  });
}

/** Approve the previewed allocations (second operator step) and move the season to distribution. */
export async function approveRewards(ctx: AppContext, actorId: string) {
  const out = await withTx(ctx.db, async (tx) => {
    const pool = (await tx.query("SELECT p.* FROM reward_pools p JOIN seasons s ON s.id=p.season_id WHERE s.state='RESULT_VERIFICATION' FOR UPDATE OF p")).rows[0];
    if (!pool || pool.status !== 'previewed') throw new AppError(409, 'NOTHING_TO_APPROVE', 'Preview the rewards first.');
    await tx.query("UPDATE reward_allocations SET status='approved' WHERE pool_id=$1 AND status='preview'", [pool.id]);
    await tx.query("UPDATE reward_pools SET status='approved', approved_by=$2, approved_at=$3 WHERE id=$1", [pool.id, actorId, new Date(ctx.now())]);
    await enterRewardDistribution(ctx, tx, actorId);
    await audit(tx, actorId, 'rewards.approve', 'reward_pool', String(pool.id), {}, ctx.now());
    return pool.id as number;
  });
  return distributeRewards(ctx, out);
}

/**
 * Credit approved allocations. Each allocation has at most one ledger row (UNIQUE allocation_id),
 * so running this any number of times can never pay twice. Failures are recorded for retry.
 */
export async function distributeRewards(ctx: AppContext, poolId: number) {
  const pending = (await ctx.db.query("SELECT a.id FROM reward_allocations a WHERE a.pool_id=$1 AND a.status IN ('approved','failed') ORDER BY a.id", [poolId])).rows;
  let completed = 0, failed = 0;
  for (const { id } of pending) {
    await withTx(ctx.db, async (tx) => {
      const a = (await tx.query('SELECT a.*, u.suspended FROM reward_allocations a JOIN users u ON u.id=a.user_id WHERE a.id=$1 FOR UPDATE OF a', [id])).rows[0];
      if (a.status === 'distributed') return;
      await tx.query("INSERT INTO reward_transactions (allocation_id, user_id, units, status, created_at, updated_at) VALUES ($1,$2,$3,'pending',$4,$4) ON CONFLICT (allocation_id) DO NOTHING", [a.id, a.user_id, a.units, new Date(ctx.now())]);
      const t = (await tx.query('SELECT * FROM reward_transactions WHERE allocation_id=$1 FOR UPDATE', [a.id])).rows[0];
      if (t.status === 'completed') {
        await tx.query("UPDATE reward_allocations SET status='distributed' WHERE id=$1", [a.id]);
        return;
      }
      const error = simulatedDistributor(a);
      if (error) {
        await tx.query("UPDATE reward_transactions SET status='failed', attempts=attempts+1, error=$2, updated_at=$3 WHERE id=$1", [t.id, error, new Date(ctx.now())]);
        await tx.query("UPDATE reward_allocations SET status='failed' WHERE id=$1", [a.id]);
        failed++;
        return;
      }
      await tx.query("INSERT INTO token_balances (user_id, units, updated_at) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET units = token_balances.units + $2, updated_at=$3", [a.user_id, a.units, new Date(ctx.now())]);
      await tx.query("UPDATE reward_transactions SET status='completed', attempts=attempts+1, error=NULL, external_ref=$2, updated_at=$3 WHERE id=$1", [t.id, `sim-${t.id}`, new Date(ctx.now())]);
      await tx.query("UPDATE reward_allocations SET status='distributed' WHERE id=$1", [a.id]);
      completed++;
    });
  }
  const remaining = (await ctx.db.query("SELECT count(*)::int AS n FROM reward_allocations WHERE pool_id=$1 AND status <> 'distributed'", [poolId])).rows[0].n;
  await ctx.db.query('UPDATE reward_pools SET status=$2 WHERE id=$1', [poolId, remaining ? 'partially_failed' : 'distributed']);
  return { poolId, completed, failed, remaining };
}

/** Stand-in for an external payout system: refuses accounts suspended after approval. */
function simulatedDistributor(a: { suspended: boolean }): string | null {
  return a.suspended ? 'Account suspended — payout held for review' : null;
}

export async function rewardStatus(tx: Pick<Tx, 'query'>, seasonId: number) {
  const pool = (await tx.query('SELECT * FROM reward_pools WHERE season_id=$1', [seasonId])).rows[0] ?? null;
  if (!pool) return { pool: null, allocations: [] };
  const allocations = (await tx.query('SELECT a.id, a.user_id, u.username, a.category, a.units::text AS units, a.basis, a.status, t.error FROM reward_allocations a JOIN users u ON u.id=a.user_id LEFT JOIN reward_transactions t ON t.allocation_id=a.id WHERE a.pool_id=$1 ORDER BY a.units DESC LIMIT 500', [pool.id])).rows;
  return { pool: { ...pool, total_units: String(pool.total_units) }, allocations };
}
