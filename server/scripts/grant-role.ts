/**
 * Grant an operator role from the command line (there is deliberately no HTTP endpoint that can
 * create the first administrator). Stop the game server first when using the embedded database.
 *   npm run admin:grant -w server -- <username> <player|moderator|admin|superadmin>
 */
import { env } from '../src/env.js';
import { createPool } from '../src/db.js';

const [username, role] = process.argv.slice(2);
if (!username || !['player', 'moderator', 'admin', 'superadmin'].includes(role)) {
  console.error('usage: grant-role <username> <player|moderator|admin|superadmin>');
  process.exit(1);
}
const db = createPool(env.databaseUrl);
const r = await db.query('UPDATE users SET role=$2 WHERE lower(username)=lower($1) RETURNING id', [username, role]);
if (!r.rowCount) {
  console.error(`No user named ${username}`);
  process.exit(1);
}
await db.query("INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, details) VALUES (NULL, 'player.role.cli', 'user', $1, $2)", [r.rows[0].id, JSON.stringify({ role })]);
console.log(`${username} is now ${role}`);
await db.end();
