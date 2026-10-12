# Security & anti-cheat

The client is treated as untrusted. It sends **intents** ("upgrade building X", "attack stage 3 with these
troops"); the server derives every outcome.

| Threat | Mitigation | Where |
|---|---|---|
| Creating resources | No endpoint accepts amounts. Production is computed from server timestamps; rewards are computed server-side and capped by storage. | `shared/src/rules/kingdom.ts`, `services/battles.ts` |
| Negative balances / overspending | `spend()` checks first; `CHECK (gold >= 0 …)` in the DB; all-or-nothing transactions. | `rules/resources.ts`, `001_init.sql` |
| Double requests / races | Per-kingdom row lock (`FOR UPDATE`); `Idempotency-Key` stored in the same transaction; unique constraints for claims, score events, ledger rows. Tested with concurrent requests. | `services/kingdomService.ts`, `lib/http.ts` |
| Faking a victory | Server chooses the seed, validates troops, runs the simulation, stores input + result; body fields like `victory`/`rewards` are ignored. Admins can re-simulate to detect tampering. | `services/battles.ts`, `/admin/battles/:id/verify` |
| Finishing timers early | Completion only when server time ≥ `ends_at`; device clock never used. | `settle()` |
| Claiming twice | Row lock + `claimed_at` check (missions); `INSERT … ON CONFLICT DO NOTHING` (clan missions); `UNIQUE (allocation_id)` (rewards). | `routes/missions.ts`, `services/rewards.ts` |
| Point farming | Unique `source_ref` per score event; repeat-attack diminishing returns and limits; shields; PvE paid attempts/day; territory attempts/day + cooldown; participation daily cap; min seconds between battles. | `services/scores.ts`, config |
| Multi-accounts | Salted IP hash on registration → `many_accounts_same_ip` signal; admin view of same-IP accounts. Clan mates can't attack each other. | `routes/auth.ts`, admin |
| Unauthorized clan actions | Role checked after locking the clan row; membership PK prevents duplicates; leader uniqueness index. | `routes/clans.ts` |
| Roster manipulation | Edits only before the war; lock re-validates eligibility and is final; war attacks require locked roster membership on both sides. | `services/clanWar.ts` |
| Privilege escalation | Role hierarchy enforced server-side per route; first admin only via CLI; role changes audited. | `lib/http.ts`, `scripts/grant-role.ts` |
| Account takeover | scrypt (N=16384) password hashes, timing-safe compare; opaque random 256-bit tokens stored as SHA-256; sessions expire; suspension revokes sessions; login/register rate limits. | `auth/` |
| Spoofed Telegram identity | HMAC-SHA256 verification of `initData` with the bot token, freshness check (24 h). Client-supplied ids are never trusted. | `auth/telegram.ts` |
| Data leakage | Public profile endpoint selects an explicit safe field list (tested). No emails stored. Raw IPs never stored. | `routes/profile.ts` |
| Injection | Parameterised SQL everywhere; Zod validation of every body/param; 64 KB body limit. | routes |
| Abuse / DoS | Per-IP global limit, per-user bucket limits on expensive routes. | `lib/rateLimit.ts` |

## Risk-based review (no automatic bans)

Signals are written to `suspicious_events` (idempotency key reuse with a different body, many accounts per IP,
…). Moderators review them in the admin panel and record a decision (`dismissed` / `actioned`) with a note;
flagging a player "under review" excludes them from reward eligibility until cleared; suspension requires an
admin and a note. Every decision is in `admin_audit_logs`.

## Audit trails

* `resource_transactions` — every balance change (delta, balance after, reason, reference).
* `battles` — seed, inputs, config version, result, rewards, score.
* `score_events` — every point with its source.
* `season_transitions`, `season_reset_log`, `season_archives`.
* `reward_allocations`, `reward_transactions` — full payout history including failures.
* `admin_audit_logs` — config changes, forced transitions, reschedules, reward approvals, resets, moderation.

## Backups & recovery

* Season reset is a single transaction (all-or-nothing) and archives every kingdom first.
* Run `pg_dump` before every season reset and on a schedule (see DEPLOYMENT.md); test restores regularly.
* A reset can be re-run safely; it never double-applies.

## Token rewards — future integration

The ledger is simulated. A real token integration must be a separate, reviewed service: keys in an HSM/KMS
(never in the frontend or this database), signed payout requests referencing `reward_transactions.id` as the
idempotency key, transaction monitoring and reconciliation, and legal/compliance review (KYC, jurisdictions,
tax). No price, profit or return is promised anywhere in the game.
