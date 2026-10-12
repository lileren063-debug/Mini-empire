import type { Tx } from '../db.js';

export async function audit(tx: Pick<Tx, 'query'>, actorId: string | null, action: string, targetType: string | null, targetId: string | null, details: Record<string, unknown>, now: number) {
  await tx.query('INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
    actorId, action, targetType, targetId, JSON.stringify(details), new Date(now),
  ]);
}
