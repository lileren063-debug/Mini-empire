# Architecture

```
┌──────────── client (React, untrusted) ────────────┐        ┌──────────── server (Fastify, authoritative) ─────────────┐
│ screens/   Kingdom · Army · World · Clan · Season │  HTTPS │ routes/   validate (Zod) · authenticate · rate-limit      │
│ render/    isometric SVG sprites                  │ ─────► │ lib/http  mutation(): BEGIN · idempotency · COMMIT        │
│ Battle.tsx replay = re-run shared engine          │ bearer │ services/ kingdomService.withKingdom()                    │
│ api.ts     intents + Idempotency-Key              │ token  │           battles · clanWar · territories · season · ...  │
└───────────────┬───────────────────────────────────┘        └───────────────┬───────────────────────────┬───────────────┘
                │ imports                                                    │ imports                   │ SQL
                ▼                                                            ▼                           ▼
        ┌──────────────────────── shared/ (pure TypeScript) ─────────────────────────┐        ┌──── PostgreSQL ────┐
        │ config/  all balancing data (+ buildConfig(tunables))                       │        │ migrations/*.sql   │
        │ rules/   placement · upgrades · production · training · resources          │        │ row locks, CHECKs, │
        │ battle/  deterministic engine + seeded RNG                                  │        │ unique keys        │
        │ season/  state machine   scoring/ leaderboards · matchmaking · rewards      │        └────────────────────┘
        └─────────────────────────────────────────────────────────────────────────────┘
```

## Separation of concerns

| Concern | Where | Notes |
|---|---|---|
| Game rules | `shared/src/rules`, `shared/src/battle` | Pure functions of `(state, ctx{now, cfg, newId})`. No I/O, no clock, no randomness except the seeded RNG. |
| Balancing data | `shared/src/config` | Tables + `buildConfig(tunables)` merges operator overrides from the `game_config` table. |
| Server logic | `server/src/services` | Loads state, calls rules, persists, records events. |
| Database access | `server/src/services/kingdomRepo.ts` and service-local SQL | Explicit SQL, parameterised. |
| Reward calculation | `shared/src/scoring/rewards.ts` (pure) + `server/src/services/rewards.ts` (workflow) | Integer micro-units (BigInt). |
| UI | `client/src` | Displays state, sends intents. Never computes authoritative outcomes. |

## The kingdom mutation pipeline

Every change to a player's kingdom goes through `withKingdom()` (`server/src/services/kingdomService.ts`):

1. `SELECT … FROM kingdoms WHERE user_id = $1 FOR UPDATE` — serialises all concurrent requests of a player.
2. Load buildings, construction queue, balances, troops and training queue into a `KingdomState`.
3. `settle(state, now)` — finish constructions whose timers elapsed (in time order, producers earn at the old
   rate until the upgrade completes) and move finished troops from the queue to the army.
4. Run the action (e.g. `startUpgrade`) — throws `GameRuleError` on any rule violation.
5. `saveKingdom()` writes only the diff; `resource_balances` has `CHECK (gold >= 0 …)`.
6. `logResourceTx()` appends the net balance change to `resource_transactions` (audit trail).
7. Rule events (`building_upgraded`, `resources_collected`, `troops_trained`) become mission progress,
   achievements and participation score inside the same transaction.

`mutation()` (`server/src/lib/http.ts`) wraps this in `BEGIN … COMMIT` and handles `Idempotency-Key`: the key row
is inserted in the same transaction, so a retried request either waits for and returns the first response or
re-executes only if the first attempt rolled back.

## Time

Only the server clock is used (`ctx.now()`, injectable for tests). The client receives `serverTime` with each
kingdom response and keeps an offset for countdowns. Production accrues from `last_tick_at` timestamps written
by the server; the device clock is never trusted.

## Battles

`simulateBattle(input, cfg)` is a 10 Hz fixed-step simulation on the 24×24 grid:

* units spawn along the chosen edges (positions from the seeded RNG), pick a target by priority
  (`any` → nearest building, `defense` → nearest tower), path-find with Dijkstra where walls cost 8 and other
  buildings 40 (so troops walk around walls when cheap, break through otherwise),
* blocked units attack the wall/building in their path; damage uses per-category modifiers (siege ×4 vs walls),
* archer towers shoot the nearest unit, heavy towers the toughest unit with splash damage,
* ends on full destruction, army wiped or 3 minutes. Stars: 50 % destruction, HQ destroyed, 100 %.

The server picks the seed, validates the deployment against owned troops, runs the simulation and stores
`input` + `result` + `config_version`. The client fetches `/battles/:id` and re-runs the same engine with
`record: true` to animate the replay. `/admin/battles/:id/verify` re-simulates to detect tampering.

## Seasons

`seasons.state` follows `DEVELOPMENT → WAR_PREPARATION → WAR_ACTIVE → RESULT_VERIFICATION →
REWARD_DISTRIBUTION → SEASON_RESET → COMPLETED`. `seasonTick()` (every `SEASON_TICK_SECONDS`, idempotent) enters
the time-driven states when their day starts; entering a state runs its side effects in the same transaction
(roster lock + matchmaking, war/territory finalisation + final leaderboard snapshots). Reward distribution and
reset require operator actions. See [GAME_RULES.md](GAME_RULES.md).

## Database entities

The schema (`server/migrations/001_init.sql`) maps the requested entities as follows:

| Requested | Table(s) |
|---|---|
| Users, PlayerProfiles | `users`, `sessions`, `player_profiles` |
| Kingdoms, Buildings, ResourceBalances, ResourceTransactions, ConstructionQueues | `kingdoms`, `buildings`, `resource_balances`, `resource_transactions`, `construction_queues` |
| Barracks, Troops, Armies | Barracks = `buildings(type='barracks')` + `training_queue`; Troops/Armies = `troops` (count per type) |
| Battles, BattleReports | `battles` (inputs, seed, result), `battle_reports` (per participant), `pve_progress` |
| Clans, ClanMemberships, ClanMessages, ClanWars | `clans`, `clan_memberships` (PK user_id ⇒ one clan), `clan_join_requests`, `clan_messages`, `clan_events`, `clan_war_rosters`, `clan_wars` |
| Territories, TerritoryOwnershipHistory | `territories`, `territory_ownership_history` |
| Missions, MissionProgress | definitions in `shared/src/config/missions.ts` (+ tunables); `mission_progress`, `clan_mission_progress`, `clan_mission_contributors`, `clan_mission_claims` |
| Seasons, SeasonParticipants, LeaderboardSnapshots | `seasons`, `season_transitions`, `season_participants`, `score_events`, `leaderboard_snapshots` |
| RewardPools, RewardAllocations, RewardTransactions | `reward_pools`, `reward_allocations`, `reward_transactions` (UNIQUE allocation_id), `token_balances` |
| CosmeticInventory, Achievements | `cosmetic_inventory`, `achievements` |
| AdministrativeAuditLogs | `admin_audit_logs`, `suspicious_events`, `error_logs`, `game_config` |
| (reset safety) | `season_archives`, `season_reset_log`, `idempotency_keys` |
