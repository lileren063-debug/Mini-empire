# HTTP API

Base path: `/api`. JSON in, JSON out.

* **Auth:** `Authorization: Bearer <token>` (from register/login/telegram). Missing/invalid → `401`.
* **Idempotency:** every state-changing request may carry `Idempotency-Key: <8–80 chars [A-Za-z0-9_-]>`. A retry
  with the same key and body returns the stored response without executing again; the same key with a different
  body → `422 IDEMPOTENCY_MISMATCH`. The official client sends a fresh key on every mutation.
* **Errors:** `{ "error": { "code": "INSUFFICIENT_RESOURCES", "message": "Not enough resources (missing 200 gold)." } }`
  * `400` rule violation / invalid input (`INVALID_INPUT`, `OVERLAP`, `HQ_TOO_LOW`, `NO_BUILDER`, `NOT_ENOUGH_TROOPS` …)
  * `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict (`ALREADY_CLAIMED`, `ROSTER_LOCKED`, …),
    `422` idempotency mismatch, `429` rate limited, `500` internal (logged to `error_logs`).
* **Rate limits** (per user, or per IP when anonymous): global 600/min/IP, kingdom actions 120/min, collect 60/min,
  battles 20/min, chat 10/min, register 5/h, login 10/15 min.
* Times are epoch milliseconds (server clock) unless a field is an ISO timestamp from the database.

Unknown fields in request bodies are ignored — they can never influence results.

---

## Auth

| Method & path | Body | Response |
|---|---|---|
| `POST /auth/register` | `{ username: 3–20 [A-Za-z0-9_], password: 8–100 }` | `{ token, user: { id, username, role } }` — creates the account, profile and starting kingdom |
| `POST /auth/login` | `{ username, password }` | `{ token, user }` |
| `POST /auth/telegram` | `{ initData }` (raw `Telegram.WebApp.initData`) | `{ token, user }` — signature verified with `TELEGRAM_BOT_TOKEN`; 501 if not configured |
| `POST /auth/logout` | – | `{ ok: true }` |
| `GET /auth/me` | – | `{ user }` |

## Configuration & kingdom

| Method & path | Body | Notes |
|---|---|---|
| `GET /config` | – | Effective balancing config (`GameConfig`): buildings (10 levels each), troops, economy, battle, missions, clan war rules. |
| `GET /kingdom` | – | Settles timers then returns the **KingdomView** below. |
| `POST /kingdom/buildings` | `{ type, x, y }` | Place a new building (charges level-1 cost, uses a builder unless instant). Response: KingdomView + `building`. |
| `POST /kingdom/buildings/:id/upgrade` | – | Start upgrade. |
| `POST /kingdom/buildings/:id/cancel` | – | Cancel construction, 50 % refund; brand-new buildings are removed. Response includes `refund`. |
| `POST /kingdom/buildings/:id/move` | `{ x, y }` | Free move, validated. |
| `POST /kingdom/collect` | `{ buildingId? }` | Collect one or all producers. Response includes `collected`. |
| `GET /kingdom/transactions` | – | Last 50 audit rows of the player's balance changes. |
| `POST /army/train` | `{ troop, count: 1–100 }` | Enqueue training (charges full cost). |
| `POST /army/train/:id/cancel` | – | Unstarted units 100 % refund, unit in training 50 %. |

**KingdomView**

```json
{
  "serverTime": 1791824217769, "configVersion": "default",
  "resources": { "gold": 1400, "wood": 1250, "stone": 500 }, "storageCapacity": 4000,
  "hqLevel": 1, "builders": 1,
  "buildings": [{ "id": "uuid", "type": "gold_mine", "level": 0, "x": 3, "y": 3, "stored": 0, "lastTickAt": 0,
                  "upgrade": { "toLevel": 1, "startedAt": 0, "endsAt": 0 }, "produced": 0 }],
  "troops": { "infantry": 0, "archer": 0, "cavalry": 0, "siege": 0 },
  "trainingQueue": [{ "id": "uuid", "troop": "infantry", "remaining": 5, "perUnitMs": 20000, "startsAt": 0, "unitCost": {"gold":50,"wood":25,"stone":0} }],
  "armyCapacity": 20, "housingUsed": 5, "troopMultiplier": 1, "shieldUntil": 0
}
```

## Battles

`deployments`: `[{ troop: 'infantry'|'archer'|'cavalry'|'siege', count: 1–200, side: 'north'|'south'|'east'|'west' }]` (1–12 entries).
Total per troop must not exceed the troops you own.

| Method & path | Body | Notes |
|---|---|---|
| `GET /battles/pve` | – | `{ stages: [{ id, name, hqRequired, reward, firstClearBonus, bestStars, unlocked, rewardedAttemptsLeft, layout }] }` |
| `POST /battles/pve` | `{ stage, deployments }` | → **BattleOutcome** |
| `GET /battles/opponents` | – | `{ opponents: [{ id, username, hqLevel, power, avatar, clanTag, scoreMultiplier }] }` (not shielded, not clan mates, within HQ range, not attacked 3× in 24 h) |
| `GET /battles/opponents/:id/layout` | – | `{ layout: [{ type, level, x, y }] }` (scouting) |
| `POST /battles/pvp` | `{ defenderId, deployments }` | → BattleOutcome (loot, shield, diminishing returns) |
| `GET /battles` | – | `{ reports: [{ battle_id, role, summary, kind, attacker, defender, created_at }] }` |
| `GET /battles/:id` | – | Full record for replay (participants and staff only): `{ battle: { input, result, rewards, scorePoints, configVersion, … } }` |

**BattleOutcome**

```json
{ "battleId": "uuid", "kind": "pve", "seed": 123,
  "result": { "victory": true, "stars": 3, "destructionPercent": 100, "hqDestroyed": true, "ticks": 382,
              "deployed": {…}, "casualties": {…}, "survivors": {…}, "buildingsDestroyed": 4, "totalBuildings": 4, "wallsDestroyed": 0 },
  "rewards": { "gold": 900, "wood": 900, "stone": 450 }, "scorePoints": 6, "notes": ["First clear bonus!"] }
```

## Missions

| Method & path | Notes |
|---|---|
| `GET /missions` | `{ missions: [{ id, period, title, event, target, reward, progress, claimed, resetsAt }], clanMissions: [...], serverTime }` |
| `POST /missions/:id/claim` | Requires progress ≥ target for the current UTC period; once only (`409 ALREADY_CLAIMED`). → `{ credited, resources }` |
| `POST /clan-missions/:id/claim` | Clan mission completed this ISO week and you contributed; once only. |

## Clans

| Method & path | Body | Permission |
|---|---|---|
| `GET /clans?search=` | – | any player |
| `GET /clans/mine` | – | `{ clan: ClanDetails|null, myRole }` |
| `GET /clans/:id` | – | ClanDetails: members, requests (staff only), events, seasonScore, seasonHistory, wars |
| `POST /clans` | `{ name, tag, description?, emblem: { icon, color }, joinPolicy: 'open'|'closed' }` | not in a clan; costs 1000 gold |
| `POST /clans/:id/join` | – | not in a clan; open → `joined`, closed → `requested` |
| `POST /clans/requests/:userId/approve` / `reject` | – | leader/officer |
| `POST /clans/leave` | – | leader must transfer first unless last member (then the clan is disbanded) |
| `POST /clans/members/:userId/role` | `{ role: 'officer'|'member' }` | leader |
| `POST /clans/members/:userId/kick` | – | leader (anyone), officer (members only) |
| `POST /clans/transfer` | `{ userId }` | leader |
| `PUT /clans/settings` | `{ description?, emblem?, joinPolicy? }` | leader/officer |
| `GET /clans/chat?after=<id>` / `POST /clans/chat` `{ body }` | | members |
| `GET /clans/war` | – | rules, eligibility per member, current war, enemy roster, attacks left |
| `PUT /clans/war/roster` | `{ userIds: uuid[] }` | leader/officer, only in DEVELOPMENT / WAR_PREPARATION |
| `POST /clans/war/attack` | `{ defenderId, deployments }` | locked roster member, WAR_ACTIVE, attack limit |

## World map

| Method & path | Notes |
|---|---|
| `GET /world` | `{ season, attacksOpen, rules, myClanId, territories: [{ id, name, kind, value, mapX, mapY, adjacent, owner, status, cooldownUntil, effectiveGarrison, myAttemptsLeft, holdPoints, layout }] }` |
| `GET /world/territories/:id/history` | `{ ownership: [...], battles: [...] }` |
| `POST /world/territories/:id/attack` | `{ deployments }` → BattleOutcome; WAR_ACTIVE only, clan member, HQ ≥ 3, attempt limit, cooldown |

## Season & leaderboards

| Method & path | Notes |
|---|---|
| `GET /season` | season (number, state, day, startsAt, endsAt, schedule), timeline, scoring explanation, my scores, simulated reward info |
| `GET /leaderboards/:board` | `board = clan | individual | participation` → `{ entries (top 100), me, total }` |
| `GET /season/history` | last seasons with final top-10 per board |

## Profile & store

| Method & path | Notes |
|---|---|
| `GET /profile/me` | public profile + role, onboarding flag, simulated token balance |
| `GET /profile/:id` | public profile only (no credentials, Telegram id, IP hash, moderation flags) |
| `PUT /profile` | `{ avatar?, title?, equipped? }` — titles/cosmetics must be owned |
| `POST /profile/onboarding` | marks the tutorial as seen |
| `GET /store` | cosmetics catalogue + owned flags, `paymentsEnabled: false` |
| `POST /store/purchase` | always `501 PAYMENTS_DISABLED` |

## Admin (role-based; every sensitive action writes `admin_audit_logs`)

| Method & path | Min role | Notes |
|---|---|---|
| `GET /admin/overview` | moderator | counts, season, health, recent errors |
| `GET /admin/players?q=` · `GET /admin/players/:id` | moderator | progression, balances, transactions, battles, flags, scores, same-IP accounts |
| `POST /admin/players/:id/review` `{ underReview, note }` | moderator | excludes from rewards while flagged |
| `POST /admin/players/:id/suspend` `{ suspended, note }` | admin | also revokes sessions |
| `POST /admin/players/:id/role` `{ role, note }` | superadmin | |
| `GET /admin/clans?q=` · `GET /admin/clans/:id` | moderator | |
| `GET /admin/config` · `PUT /admin/config` `{ tunables, note }` | moderator · admin | validated tunables, versioned |
| `GET /admin/season` | moderator | transitions, wars, reset log |
| `POST /admin/season/transition` `{ to, reason }` | superadmin | forced *valid* transition only |
| `POST /admin/season/schedule` `{ startsAt, schedule, reason }` | superadmin | only before war phase |
| `POST /admin/season/reset` `{ confirm: "RESET SEASON <n>" }` | superadmin | idempotent |
| `GET /admin/leaderboards` | moderator | live boards + snapshots |
| `GET /admin/rewards` · `POST /admin/rewards/preview` `{ poolTokens, allocation? }` | moderator · admin | RESULT_VERIFICATION only |
| `POST /admin/rewards/approve` | superadmin | moves season to REWARD_DISTRIBUTION and distributes |
| `POST /admin/rewards/retry` | admin | re-attempts failed allocations (never double-pays) |
| `GET /admin/suspicious?status=` · `POST /admin/suspicious/:id/review` `{ status, note }` | moderator | human decision recorded |
| `GET /admin/battles/:id/verify` | moderator | re-simulates stored input, `matches: true|false` |
| `GET /admin/audit` | admin | last 200 audit rows |

`GET /api/health` → `{ ok: true, time }` (no auth).
