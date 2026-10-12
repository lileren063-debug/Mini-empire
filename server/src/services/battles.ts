import { randomInt } from 'node:crypto';
import {
  PVE_STAGES, PVE_REWARDED_ATTEMPTS_PER_STAGE_PER_DAY, PVE_STAR_REWARD_SHARE, SCORING, TROOP_TYPES,
  grantResources, hqLevel, repeatAttackMultiplier, scaleResources, simulateBattle, troopMultiplier,
  type BattleResult, type DefenseBuilding, type Deployment, type KingdomState, type Resources, type TroopCounts,
} from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import type { Tx } from '../db.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { loadKingdom } from './kingdomRepo.js';
import { withKingdom } from './kingdomService.js';
import { grantAchievement, recordProgress } from './progress.js';
import { addScore, clanOf, currentSeason } from './scores.js';

export type BattleKind = 'pve' | 'pvp' | 'war' | 'territory';

export function validateDeployments(deployments: Deployment[], troops: TroopCounts): void {
  if (!deployments.length) throw badRequest('NO_TROOPS', 'Select at least one troop to attack with.');
  const used: Partial<TroopCounts> = {};
  for (const d of deployments) {
    if (!TROOP_TYPES.includes(d.troop)) throw badRequest('UNKNOWN_TROOP', 'Unknown troop type.');
    used[d.troop] = (used[d.troop] ?? 0) + d.count;
  }
  for (const t of TROOP_TYPES) {
    if ((used[t] ?? 0) > troops[t]) throw badRequest('NOT_ENOUGH_TROOPS', `You only have ${troops[t]} ${t}.`);
  }
}

export function layoutFromState(state: KingdomState): DefenseBuilding[] {
  return state.buildings.filter((b) => b.level >= 1).map((b) => ({ id: b.id, type: b.type, level: b.level, x: b.x, y: b.y }));
}

export interface BattleOutcome {
  battleId: string;
  kind: BattleKind;
  result: BattleResult;
  rewards: Resources;
  scorePoints: number;
  seed: number;
  notes: string[];
}

interface CoreArgs {
  kind: BattleKind;
  defense: DefenseBuilding[];
  deployments: Deployment[];
  defenderId?: string | null;
  pveStage?: number;
  territoryId?: string;
  warId?: string;
  /** Computes rewards/score after the simulation (inside the same transaction). */
  settleRewards: (r: BattleResult, attacker: KingdomState, battleId: string) => Promise<{ rewards: Resources; scorePoints: number; notes: string[] }>;
}

/**
 * Authoritative battle resolution. The client only chooses *which* troops to send and from
 * which side; the server checks the troops exist, picks the random seed, runs the deterministic
 * simulation, removes casualties, and computes every reward and score itself.
 */
export async function runBattle(ctx: AppContext, tx: Tx, attackerId: string, a: CoreArgs): Promise<BattleOutcome> {
  const now = ctx.now();
  const season = await currentSeason(tx);
  const seed = randomInt(1, 2 ** 31 - 1);
  const battleId = (await tx.query('SELECT gen_random_uuid() AS id')).rows[0].id as string;
  const out = await withKingdom(ctx, tx, attackerId, `battle_${a.kind}`, async (state, _rc, k) => {
    if (k.lastBattleAt && now - k.lastBattleAt < ctx.cfg.battle.minSecondsBetweenBattles * 1000) {
      throw new AppError(429, 'TOO_FAST', 'Your troops need a moment before the next battle.');
    }
    validateDeployments(a.deployments, state.troops);
    const input = { seed, defense: a.defense, deployments: a.deployments, attackerMultiplier: troopMultiplier(state) };
    const { result } = simulateBattle(input, ctx.cfg);
    for (const t of TROOP_TYPES) state.troops[t] -= result.casualties[t];
    const clan = await clanOf(tx, attackerId);
    const settled = await a.settleRewards(result, state, battleId);
    await tx.query(
      `INSERT INTO battles (id, season_id, kind, attacker_id, defender_id, pve_stage, territory_id, war_id, attacker_clan_id, seed, config_version, input, result, victory, stars, destruction, rewards, score_points, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [battleId, season.id, a.kind, attackerId, a.defenderId ?? null, a.pveStage ?? null, a.territoryId ?? null, a.warId ?? null, clan?.clanId ?? null, seed, ctx.cfg.version,
        JSON.stringify(input), JSON.stringify(result), result.victory, result.stars, result.destructionPercent, JSON.stringify(settled.rewards), settled.scorePoints, new Date(now)],
    );
    const summary = { kind: a.kind, victory: result.victory, stars: result.stars, destruction: result.destructionPercent, rewards: settled.rewards, casualties: result.casualties, pveStage: a.pveStage, territoryId: a.territoryId };
    await tx.query("INSERT INTO battle_reports (battle_id, user_id, role, summary, seen, created_at) VALUES ($1,$2,'attacker',$3,true,$4)", [battleId, attackerId, JSON.stringify(summary), new Date(now)]);
    if (a.defenderId) {
      await tx.query("INSERT INTO battle_reports (battle_id, user_id, role, summary, created_at) VALUES ($1,$2,'defender',$3,$4)", [battleId, a.defenderId, JSON.stringify({ ...summary, rewards: undefined, lost: settled.rewards }), new Date(now)]);
    }
    await tx.query('UPDATE kingdoms SET last_battle_at=$2 WHERE id=$1', [k.kingdomId, new Date(now)]);
    return { result: { result, settled }, ref: battleId };
  });

  const { result, settled } = out.result;
  await recordProgress(tx, ctx.cfg, attackerId, 'battle_fought', 1, now);
  if (result.victory) {
    await grantAchievement(tx, attackerId, 'first_victory', now);
    await recordProgress(tx, ctx.cfg, attackerId, a.kind === 'pve' ? 'pve_victory' : 'pvp_victory', 1, now);
  }
  if (a.kind !== 'pve') {
    await tx.query(`UPDATE player_profiles SET ${result.victory ? 'battles_won = battles_won + 1' : 'battles_lost = battles_lost + 1'} WHERE user_id = $1`, [attackerId]);
    const { rows } = await tx.query('SELECT battles_won FROM player_profiles WHERE user_id=$1', [attackerId]);
    if (rows[0]?.battles_won >= 25) await grantAchievement(tx, attackerId, 'wins_25', now);
  }
  return { battleId, kind: a.kind, result, rewards: settled.rewards, scorePoints: settled.scorePoints, seed, notes: settled.notes };
}

/** Battle score -> individual leaderboard, plus the configured share to the player's clan. */
export async function awardBattleScore(tx: Tx, ctx: AppContext, attackerId: string, battleId: string, points: number, source: string) {
  if (points <= 0) return 0;
  const season = await currentSeason(tx);
  const now = ctx.now();
  const got = await addScore(tx, { seasonId: season.id, userId: attackerId, clanId: null, category: 'battle', points, source, ref: `battle:${battleId}` }, now);
  const clan = await clanOf(tx, attackerId);
  if (clan && got > 0) {
    const clanPts = Math.floor(got * SCORING.clan.memberContributionShare);
    const c = await addScore(tx, { seasonId: season.id, userId: attackerId, clanId: clan.clanId, category: 'clan', points: clanPts, source: 'member_battle', ref: `clanbattle:${battleId}` }, now);
    if (c > 0) {
      await tx.query('UPDATE clan_memberships SET contribution = contribution + $2 WHERE user_id = $1', [attackerId, c]);
      await recordProgress(tx, ctx.cfg, attackerId, 'clan_contribution', c, now);
    }
  }
  return got;
}

// ------------------------------------------------------------------------------------------ PvE

export async function pveStatus(ctx: AppContext, tx: Tx, userId: string) {
  const season = await currentSeason(tx);
  const k = await loadKingdom(tx, userId, false);
  const hq = hqLevel(k.state);
  const prog = await tx.query('SELECT stage, best_stars FROM pve_progress WHERE season_id=$1 AND user_id=$2', [season.id, userId]);
  const best = new Map<number, number>(prog.rows.map((r) => [r.stage, r.best_stars]));
  const today = await tx.query(
    "SELECT pve_stage, count(*)::int AS n FROM battles WHERE attacker_id=$1 AND kind='pve' AND created_at >= date_trunc('day', $2::timestamptz) GROUP BY pve_stage",
    [userId, new Date(ctx.now()).toISOString()],
  );
  const attempts = new Map<number, number>(today.rows.map((r) => [r.pve_stage, r.n]));
  return PVE_STAGES.map((s) => ({
    id: s.id,
    name: s.name,
    hqRequired: s.hqRequired,
    reward: s.reward,
    firstClearBonus: s.firstClearBonus,
    bestStars: best.get(s.id) ?? 0,
    unlocked: hq >= s.hqRequired && (s.id === 1 || (best.get(s.id - 1) ?? 0) >= 1),
    rewardedAttemptsLeft: Math.max(0, PVE_REWARDED_ATTEMPTS_PER_STAGE_PER_DAY - (attempts.get(s.id) ?? 0)),
    layout: s.layout,
  }));
}

export async function attackPve(ctx: AppContext, tx: Tx, userId: string, stageId: number, deployments: Deployment[]): Promise<BattleOutcome> {
  const stage = PVE_STAGES.find((s) => s.id === stageId);
  if (!stage) throw notFound('Unknown stage');
  const status = (await pveStatus(ctx, tx, userId)).find((s) => s.id === stageId)!;
  if (!status.unlocked) throw badRequest('STAGE_LOCKED', `Clear the previous stage and reach HQ ${stage.hqRequired} first.`);
  const season = await currentSeason(tx);
  const defense = stage.layout.map((b, i) => ({ ...b, id: `pve${stage.id}-${i}` }));
  return runBattle(ctx, tx, userId, {
    kind: 'pve',
    defense,
    deployments,
    pveStage: stage.id,
    settleRewards: async (r, attacker, battleId) => {
      const notes: string[] = [];
      let rewards: Resources = { gold: 0, wood: 0, stone: 0 };
      if (status.rewardedAttemptsLeft <= 0) {
        notes.push('Daily reward limit reached for this stage: no resources or points this time.');
        return { rewards, scorePoints: 0, notes };
      }
      if (r.stars > 0) {
        const share = PVE_STAR_REWARD_SHARE[r.stars];
        let gross = scaleResources(stage.reward, share);
        const prev = await tx.query('SELECT best_stars, first_cleared_at FROM pve_progress WHERE season_id=$1 AND user_id=$2 AND stage=$3', [season.id, userId, stage.id]);
        if (!prev.rows[0]?.first_cleared_at) {
          gross = { gold: gross.gold + stage.firstClearBonus.gold, wood: gross.wood + stage.firstClearBonus.wood, stone: gross.stone + stage.firstClearBonus.stone };
          notes.push('First clear bonus!');
        }
        rewards = grantResources(attacker, ctx.cfg, gross);
        if (rewards.gold < gross.gold || rewards.wood < gross.wood || rewards.stone < gross.stone) notes.push('Some rewards were lost because your storage is full.');
      }
      await tx.query(
        `INSERT INTO pve_progress (season_id, user_id, stage, best_stars, first_cleared_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (season_id, user_id, stage) DO UPDATE SET best_stars = GREATEST(pve_progress.best_stars, $4),
           first_cleared_at = COALESCE(pve_progress.first_cleared_at, $5)`,
        [season.id, userId, stage.id, r.stars, r.stars > 0 ? new Date(ctx.now()) : null],
      );
      const cleared = await tx.query('SELECT count(*)::int AS n FROM pve_progress WHERE season_id=$1 AND user_id=$2 AND best_stars >= 1', [season.id, userId]);
      if (cleared.rows[0].n >= PVE_STAGES.length) await grantAchievement(tx, userId, 'pve_master', ctx.now());
      const scorePoints = await awardBattleScore(tx, ctx, userId, battleId, r.stars * SCORING.individual.pvePointsPerStar, 'pve');
      return { rewards, scorePoints, notes };
    },
  });
}

// ------------------------------------------------------------------------------------------ PvP

export async function pvpCandidates(ctx: AppContext, tx: Tx, userId: string) {
  const me = await loadKingdom(tx, userId, false);
  const myHq = hqLevel(me.state);
  const myClan = await clanOf(tx, userId);
  const now = new Date(ctx.now());
  const { rows } = await tx.query(
    `SELECT u.id, u.username, k.hq_level, k.power, p.avatar, cm.clan_id, c.tag AS clan_tag,
            (SELECT count(*)::int FROM battles b WHERE b.attacker_id = $1 AND b.defender_id = u.id AND b.created_at > $4::timestamptz - interval '24 hours') AS recent_attacks
       FROM kingdoms k JOIN users u ON u.id = k.user_id JOIN player_profiles p ON p.user_id = u.id
       LEFT JOIN clan_memberships cm ON cm.user_id = u.id LEFT JOIN clans c ON c.id = cm.clan_id
      WHERE u.id <> $1 AND NOT u.suspended AND abs(k.hq_level - $2) <= $3
        AND (k.shield_until IS NULL OR k.shield_until < $4)
      ORDER BY abs(k.power - (SELECT power FROM kingdoms WHERE user_id = $1)), u.id
      LIMIT 30`,
    [userId, myHq, ctx.cfg.battle.matchmakingHqRange, now],
  );
  return rows
    .filter((r) => !myClan || r.clan_id !== myClan.clanId)
    .filter((r) => r.recent_attacks < ctx.cfg.battle.maxAttacksOnSameDefenderPer24h)
    .slice(0, 10)
    .map((r) => ({ id: r.id, username: r.username, hqLevel: r.hq_level, power: r.power, avatar: r.avatar, clanTag: r.clan_tag, scoreMultiplier: repeatAttackMultiplier(r.recent_attacks, ctx.cfg.battle.repeatAttackScoreMultipliers, ctx.cfg.battle.maxAttacksOnSameDefenderPer24h) }));
}

export async function attackPlayer(ctx: AppContext, tx: Tx, userId: string, defenderId: string, deployments: Deployment[]): Promise<BattleOutcome> {
  if (defenderId === userId) throw badRequest('SELF_ATTACK', 'You cannot attack yourself.');
  const now = ctx.now();
  // Lock both kingdoms in a fixed order to avoid deadlocks when two players attack each other.
  const locked = await tx.query('SELECT user_id FROM kingdoms WHERE user_id = ANY($1::uuid[]) ORDER BY user_id FOR UPDATE', [[userId, defenderId]]);
  if (locked.rowCount !== 2) throw notFound('Opponent not found');
  const def = (await tx.query('SELECT u.suspended, k.shield_until, k.hq_level FROM users u JOIN kingdoms k ON k.user_id=u.id WHERE u.id=$1', [defenderId])).rows[0];
  if (def.suspended) throw badRequest('UNAVAILABLE', 'That player cannot be attacked.');
  if (def.shield_until && def.shield_until.getTime() > now) throw badRequest('SHIELDED', 'That kingdom is protected by a shield.');
  const myClan = await clanOf(tx, userId);
  const theirClan = await clanOf(tx, defenderId);
  if (myClan && theirClan && myClan.clanId === theirClan.clanId) throw badRequest('SAME_CLAN', 'You cannot attack a clan mate.');
  const meK = await loadKingdom(tx, userId, false);
  if (Math.abs(hqLevel(meK.state) - def.hq_level) > ctx.cfg.battle.matchmakingHqRange) throw badRequest('OUT_OF_RANGE', 'That opponent is outside your matchmaking range.');
  const recent = await tx.query("SELECT count(*)::int AS n FROM battles WHERE attacker_id=$1 AND defender_id=$2 AND kind='pvp' AND created_at > $3", [userId, defenderId, new Date(now - 86_400_000)]);
  const mult = repeatAttackMultiplier(recent.rows[0].n, ctx.cfg.battle.repeatAttackScoreMultipliers, ctx.cfg.battle.maxAttacksOnSameDefenderPer24h);
  if (mult === null) throw badRequest('ATTACK_LIMIT', 'You have attacked this player too often today.');
  const defK = await loadKingdom(tx, defenderId, false);
  const attackerHq = hqLevel(meK.state);

  return runBattle(ctx, tx, userId, {
    kind: 'pvp',
    defense: layoutFromState(defK.state),
    deployments,
    defenderId,
    settleRewards: async (r, attacker, battleId) => {
      const notes: string[] = [];
      let rewards: Resources = { gold: 0, wood: 0, stone: 0 };
      // Loot: only what the attacker can actually store is taken from the defender.
      await withKingdom(ctx, tx, defenderId, 'defense', (dstate) => {
        const cap = attackerHq * ctx.cfg.battle.pvpLootCapPerHqLevel;
        const share = ctx.cfg.battle.pvpLootShare * (r.destructionPercent / 100);
        const want: Resources = {
          gold: Math.min(cap, Math.floor(dstate.resources.gold * share)),
          wood: Math.min(cap, Math.floor(dstate.resources.wood * share)),
          stone: Math.min(cap, Math.floor(dstate.resources.stone * share)),
        };
        rewards = grantResources(attacker, ctx.cfg, want);
        dstate.resources.gold -= rewards.gold;
        dstate.resources.wood -= rewards.wood;
        dstate.resources.stone -= rewards.stone;
        return { result: null, ref: battleId };
      });
      await tx.query('UPDATE kingdoms SET shield_until=$2 WHERE user_id=$1', [defenderId, new Date(now + ctx.cfg.battle.defenderShieldHours * 3_600_000)]);
      await tx.query(`UPDATE player_profiles SET ${r.victory ? 'defenses_lost = defenses_lost + 1' : 'defenses_won = defenses_won + 1'} WHERE user_id=$1`, [defenderId]);
      if (mult < 1) notes.push(`Repeat attack: score x${mult}.`);
      const scorePoints = await awardBattleScore(tx, ctx, userId, battleId, Math.floor(r.stars * SCORING.individual.pvpPointsPerStar * mult), 'pvp');
      return { rewards, scorePoints, notes };
    },
  });
}
