import { TROOP_TYPES, emptyTroops, type Building, type KingdomState, type Resources, type TroopType } from '@mini-empire/shared';
import type { Tx } from '../db.js';
import { notFound } from '../lib/errors.js';

const ms = (d: Date | null) => (d ? d.getTime() : 0);

export interface LoadedKingdom {
  kingdomId: string;
  userId: string;
  seasonId: number;
  shieldUntil: number;
  lastBattleAt: number;
  state: KingdomState;
}

/** Load a kingdom. `lock` takes a row lock that serialises all mutations of this player's kingdom. */
export async function loadKingdom(tx: Tx, userId: string, lock: boolean): Promise<LoadedKingdom> {
  const k = (await tx.query(`SELECT * FROM kingdoms WHERE user_id = $1 ${lock ? 'FOR UPDATE' : ''}`, [userId])).rows[0];
  if (!k) throw notFound('Kingdom not found');
  const bal = await tx.query('SELECT gold, wood, stone FROM resource_balances WHERE kingdom_id = $1', [k.id]);
  const blds = await tx.query(
    `SELECT b.*, c.to_level, c.started_at, c.ends_at FROM buildings b
       LEFT JOIN construction_queues c ON c.building_id = b.id
      WHERE b.kingdom_id = $1 ORDER BY b.created_at, b.id`,
    [k.id],
  );
  const trp = await tx.query('SELECT troop_type, count FROM troops WHERE kingdom_id = $1', [k.id]);
  const q = await tx.query('SELECT * FROM training_queue WHERE kingdom_id = $1 ORDER BY position', [k.id]);
  const troops = emptyTroops();
  for (const r of trp.rows) if (TROOP_TYPES.includes(r.troop_type)) troops[r.troop_type as TroopType] = r.count;
  const state: KingdomState = {
    resources: { gold: Number(bal.rows[0].gold), wood: Number(bal.rows[0].wood), stone: Number(bal.rows[0].stone) },
    buildings: blds.rows.map(
      (r): Building => ({
        id: r.id,
        type: r.type,
        level: r.level,
        x: r.x,
        y: r.y,
        stored: r.stored,
        lastTickAt: ms(r.last_tick_at),
        upgrade: r.to_level ? { toLevel: r.to_level, startedAt: ms(r.started_at), endsAt: ms(r.ends_at) } : null,
      }),
    ),
    troops,
    trainingQueue: q.rows.map((r) => ({
      id: r.id,
      troop: r.troop_type,
      remaining: r.remaining,
      perUnitMs: r.per_unit_ms,
      startsAt: ms(r.starts_at),
      unitCost: r.unit_cost as Resources,
    })),
  };
  return { kingdomId: k.id, userId, seasonId: k.season_id, shieldUntil: ms(k.shield_until), lastBattleAt: ms(k.last_battle_at), state };
}

/** Persist a kingdom state, writing only what changed compared to `before`. */
export async function saveKingdom(tx: Tx, kingdomId: string, before: KingdomState, after: KingdomState, meta: { hqLevel: number; power: number }) {
  const prev = new Map(before.buildings.map((b) => [b.id, b]));
  const next = new Map(after.buildings.map((b) => [b.id, b]));
  for (const id of prev.keys()) if (!next.has(id)) await tx.query('DELETE FROM buildings WHERE id = $1 AND kingdom_id = $2', [id, kingdomId]);
  for (const b of after.buildings) {
    const p = prev.get(b.id);
    if (!p) {
      await tx.query('INSERT INTO buildings (id, kingdom_id, type, level, x, y, stored, last_tick_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
        b.id, kingdomId, b.type, b.level, b.x, b.y, b.stored, new Date(b.lastTickAt),
      ]);
    } else if (p.level !== b.level || p.x !== b.x || p.y !== b.y || p.stored !== b.stored || p.lastTickAt !== b.lastTickAt) {
      await tx.query('UPDATE buildings SET level=$2, x=$3, y=$4, stored=$5, last_tick_at=$6 WHERE id=$1', [b.id, b.level, b.x, b.y, b.stored, new Date(b.lastTickAt)]);
    }
    const pu = p?.upgrade ?? null;
    const nu = b.upgrade;
    if (JSON.stringify(pu) !== JSON.stringify(nu)) {
      await tx.query('DELETE FROM construction_queues WHERE building_id = $1', [b.id]);
      if (nu) {
        await tx.query('INSERT INTO construction_queues (building_id, kingdom_id, to_level, started_at, ends_at) VALUES ($1,$2,$3,$4,$5)', [
          b.id, kingdomId, nu.toLevel, new Date(nu.startedAt), new Date(nu.endsAt),
        ]);
      }
    }
  }
  if (JSON.stringify(before.resources) !== JSON.stringify(after.resources)) {
    await tx.query('UPDATE resource_balances SET gold=$2, wood=$3, stone=$4, updated_at=now() WHERE kingdom_id=$1', [
      kingdomId, after.resources.gold, after.resources.wood, after.resources.stone,
    ]);
  }
  if (JSON.stringify(before.troops) !== JSON.stringify(after.troops)) {
    for (const t of TROOP_TYPES) {
      await tx.query(
        'INSERT INTO troops (kingdom_id, troop_type, count) VALUES ($1,$2,$3) ON CONFLICT (kingdom_id, troop_type) DO UPDATE SET count = EXCLUDED.count',
        [kingdomId, t, after.troops[t]],
      );
    }
  }
  if (JSON.stringify(before.trainingQueue) !== JSON.stringify(after.trainingQueue)) {
    await tx.query('DELETE FROM training_queue WHERE kingdom_id = $1', [kingdomId]);
    let pos = 0;
    for (const it of after.trainingQueue) {
      await tx.query(
        'INSERT INTO training_queue (id, kingdom_id, position, troop_type, remaining, per_unit_ms, starts_at, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [it.id, kingdomId, pos++, it.troop, it.remaining, it.perUnitMs, new Date(it.startsAt), JSON.stringify(it.unitCost)],
      );
    }
  }
  await tx.query('UPDATE kingdoms SET hq_level=$2, power=$3, updated_at=now() WHERE id=$1', [kingdomId, meta.hqLevel, meta.power]);
}

/** Write an audit row for a balance change. */
export async function logResourceTx(tx: Tx, kingdomId: string, userId: string, before: Resources, after: Resources, reason: string, ref?: string) {
  const d = { gold: after.gold - before.gold, wood: after.wood - before.wood, stone: after.stone - before.stone };
  if (!d.gold && !d.wood && !d.stone) return;
  await tx.query(
    `INSERT INTO resource_transactions (kingdom_id, user_id, delta_gold, delta_wood, delta_stone, gold_after, wood_after, stone_after, reason, ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [kingdomId, userId, d.gold, d.wood, d.stone, after.gold, after.wood, after.stone, reason, ref ?? null],
  );
}

export function cloneState(s: KingdomState): KingdomState {
  return structuredClone(s);
}

/** Insert a brand-new starting kingdom (exactly HQ 1, one defensive tower, one wall). */
export async function insertStartingKingdom(tx: Tx, userId: string, seasonId: number, state: KingdomState, existingKingdomId?: string): Promise<string> {
  let kingdomId = existingKingdomId;
  let before: Resources = { gold: 0, wood: 0, stone: 0 };
  if (!kingdomId) {
    kingdomId = (await tx.query('INSERT INTO kingdoms (user_id, season_id, hq_level, power) VALUES ($1,$2,1,0) RETURNING id', [userId, seasonId])).rows[0].id as string;
    await tx.query('INSERT INTO resource_balances (kingdom_id, gold, wood, stone) VALUES ($1,$2,$3,$4)', [kingdomId, state.resources.gold, state.resources.wood, state.resources.stone]);
  } else {
    const old = (await tx.query('SELECT gold, wood, stone FROM resource_balances WHERE kingdom_id=$1', [kingdomId])).rows[0];
    if (old) before = { gold: Number(old.gold), wood: Number(old.wood), stone: Number(old.stone) };
    await tx.query('UPDATE kingdoms SET season_id=$2, hq_level=1, power=0, shield_until=NULL, last_battle_at=NULL, updated_at=now() WHERE id=$1', [kingdomId, seasonId]);
    await tx.query('UPDATE resource_balances SET gold=$2, wood=$3, stone=$4, updated_at=now() WHERE kingdom_id=$1', [kingdomId, state.resources.gold, state.resources.wood, state.resources.stone]);
  }
  for (const b of state.buildings) {
    await tx.query('INSERT INTO buildings (id, kingdom_id, type, level, x, y, stored, last_tick_at) VALUES ($1,$2,$3,$4,$5,$6,0,$7)', [b.id, kingdomId, b.type, b.level, b.x, b.y, new Date(b.lastTickAt)]);
  }
  for (const t of TROOP_TYPES) {
    await tx.query('INSERT INTO troops (kingdom_id, troop_type, count) VALUES ($1,$2,0) ON CONFLICT (kingdom_id, troop_type) DO UPDATE SET count = 0', [kingdomId, t]);
  }
  await logResourceTx(tx, kingdomId, userId, before, state.resources, existingKingdomId ? 'season_reset' : 'starting_resources');
  return kingdomId;
}
