# Economy & balancing

All numbers live in `shared/src/config/`. Nothing is hard-coded in the server or client.

* `buildings.ts` — 10-level table per building (cost, duration, HQ requirement, prerequisites, HP, production,
  buffer, storage, army capacity, tower stats, builders, unlock notes) and per-HQ building count limits.
* `troops.ts` — troop stats, costs, training time, housing, unlock level, target priority, damage modifiers.
* `economy.ts` — starting resources, offline accrual window, clan cost, cancel refunds, PvP loot, shields,
  repeat-attack limits, matchmaking range.
* `missions.ts`, `pve.ts`, `territories.ts`, `scoring.ts`, `rewards.ts`, `season.ts`.

Operators can adjust **tunables** at runtime from the admin panel (`PUT /api/admin/config`); they are validated,
versioned in `game_config`, audited, and merged by `buildConfig()`:

```json
{
  "productionMultiplier": 1.2,
  "costMultiplier": 0.9,
  "durationMultiplier": 1,
  "trainingCostMultiplier": 1,
  "trainingDurationMultiplier": 1,
  "troopHpMultiplier": { "cavalry": 0.9 },
  "troopDamageMultiplier": { "siege": 1.1 },
  "missionRewardMultiplier": 1,
  "disabledMissions": ["w_clan"],
  "battle": { "pvpLootShare": 0.1, "defenderShieldHours": 6, "maxAttacksOnSameDefenderPer24h": 3, "matchmakingHqRange": 2, "minSecondsBetweenBattles": 5 },
  "clanWar": { "minHqLevel": 5, "minMembershipHours": 48, "minRosterSize": 3, "maxRosterSize": 20, "attacksPerMember": 3 }
}
```

Structural changes (new levels, prerequisites, unlocks) are edited in code and shipped with a release.

## Resource rules (enforced by code and database)

* Three resources: gold, wood, stone. Starting balance 1 500 / 1 500 / 500.
* Balances can never be negative: `spend()` checks before deducting; `resource_balances` has `CHECK (x >= 0)`.
* Costs are deducted inside the same locked transaction that changes the building — all-or-nothing.
* Producers fill an internal buffer (`bufferCap` = 10 h of production). Production stops when the buffer is
  full; offline time is never computed beyond `maxOfflineAccrualHours` (24 h) since the last collection.
* Collection is limited by storage capacity (`HQ storageCap + Σ Storage buildings`); what does not fit stays
  in the producer. Rewards (missions, battles) are also capped by storage — the UI warns when storage is full.
* Every balance change writes a `resource_transactions` row with delta, balance after, reason and reference.

## Headquarters (progression spine)

| HQ level | Gold | Wood | Stone | Duration | Storage | Builders | Requires |
|---|---|---|---|---|---|---|---|
| 1 | 0 | 0 | 0 | – | 4000 | 1 | - |
| 2 | 800 | 800 | 0 | 5 min | 8000 | 1 | - |
| 3 | 3000 | 3000 | 1500 | 1 h | 15000 | 2 | barracks 1 |
| 4 | 9000 | 9000 | 6000 | 4 h | 25000 | 2 | storage 2 |
| 5 | 20000 | 20000 | 15000 | 10 h | 40000 | 2 | archer_tower 3 |
| 6 | 42000 | 42000 | 34000 | 18 h | 60000 | 3 | barracks 4 |
| 7 | 80000 | 80000 | 66000 | 1 d | 90000 | 3 | storage 5 |
| 8 | 140000 | 140000 | 120000 | 2 d | 130000 | 3 | heavy_tower 5 |
| 9 | 250000 | 250000 | 220000 | 3 d | 180000 | 3 | barracks 7 |
| 10 | 380000 | 380000 | 330000 | 4.5 d | 240000 | 3 | storage 8 |

Other buildings: level *n* requires HQ ≥ *n − 1* (Heavy Tower: HQ ≥ 3). Costs grow ×1.95 per level (×1.8 walls),
durations follow `10 s, 2 m, 15 m, 1 h, 3 h, 6 h, 10 h, 16 h, 1 d, 1.5 d` (walls: instant level 1, ≤ 1 h).

### Producers (Gold Mine shown; Lumber Camp / Stone Quarry identical output, different cost mix)

| Lvl | Cost (g/w/s) | Time | HQ | HP | Output |
|---|---|---|---|---|---|
| 1 | 100/250/0 | 10s | 1 | 400 | 150/h, buffer 1500 |
| 2 | 200/490/0 | 2m | 1 | 472 | 191/h, buffer 1910 |
| 3 | 380/950/0 | 15m | 2 | 557 | 242/h, buffer 2420 |
| 4 | 740/1900/0 | 1h | 3 | 657 | 307/h, buffer 3070 |
| 5 | 1400/3600/0 | 3h | 4 | 776 | 390/h, buffer 3900 |
| 6 | 2800/7000/0 | 6h | 5 | 915 | 496/h, buffer 4960 |
| 7 | 5500/14000/0 | 10h | 6 | 1080 | 629/h, buffer 6290 |
| 8 | 11000/27000/0 | 16h | 7 | 1274 | 799/h, buffer 7990 |
| 9 | 21000/52000/0 | 1d | 8 | 1504 | 1015/h, buffer 10150 |
| 10 | 41000/100000/0 | 1.5d | 9 | 1774 | 1289/h, buffer 12890 |

Max producers of each type by HQ level: 1,1,2,2,2,3,3,3,4,4. Storage buildings: 1,1,1,1,2,2,2,3,3,3
(+3 000 → +210 000 capacity per building).

### Troops

| Troop | HP | Dmg | Interval | Speed | Range | Cost (g/w/s) | Train | Housing | Barracks |
|---|---|---|---|---|---|---|---|---|---|
| Infantry | 130 | 14 | 1s | 1 | 0.6 | 50/25/0 | 20s | 1 | 1 |
| Archers | 60 | 11 | 1s | 1.1 | 3.5 | 70/40/0 | 25s | 1 | 2 |
| Cavalry | 300 | 24 | 1.2s | 2 | 0.6 | 160/0/60 | 60s | 3 | 4 |
| Siege Ram | 450 | 60 | 3s | 0.6 | 0.6 | 300/300/120 | 180s | 5 | 6 |

Barracks army capacity: 20, 30, 40, 55, 70, 85, 100, 120, 140, 160. Troop HP/damage +6 % per Barracks level above 1.
Damage modifiers: archers ×0.5 vs walls; cavalry ×1.2 vs towers; siege ×4 vs walls, ×2 vs towers, ×0.5 others.

### Defences

* Archer Tower: 24 dmg × 1.22^(L−1) every 0.9 s, range 6, targets nearest. Max 1–5 by HQ.
* Heavy Tower: 70 dmg × 1.22^(L−1) every 2.5 s, range 5, splash 1.2, targets toughest. From HQ 3, max 1–3.
* Walls: 300 HP × 1.38^(L−1); 8 → 90 segments by HQ level. Path-finding cost 8 tiles, so armies break walls
  only when walking around is longer.

### Battle & mission income

* Campaign: 10 stages; reward = stage reward × (0.4 / 0.7 / 1.0 for 1/2/3 stars), first-clear bonus ×2, max 3
  paid attempts per stage per UTC day.
* PvP loot: 12 % × destruction % of the defender's stored balance, capped at 6 000 × attacker HQ per resource;
  the defender loses exactly what the attacker receives. Defender shield 4 h.
* Missions: 4 daily (≈ 1 050 gold, 850 wood, 350 stone total) and 4 weekly missions.

## The 90-day target — balance simulation

`npm run balance` plays a "regular player" through the real rules: a few short sessions per day, collecting,
building new producers when allowed, upgrading the HQ as soon as possible, otherwise its prerequisites,
storage, then producers; it also claims the main daily/weekly missions. Current results:

| Sessions per day | HQ 5 | HQ 8 | HQ 10 |
|---|---|---|---|
| 3 (8:00, 13:00, 20:00) | day 9 | day 46 | **day 77** |
| 2 (8:00, 20:00) | day 9 | day 54 | **day 86** |
| 1 (19:00) | day 16 | day 95 | not reached by day 100 |

The bot plays optimally (greedy, never idle when it can afford something), so real "regular" players land
around the 90-day target; once-a-day players finish the season around HQ 8–9, which keeps the season
competitive without demanding hours of play per day.

### How to tune

1. Change a seed in `buildings.ts` (e.g. production growth `1.27`, HQ costs) or use tunables for quick global
   changes (`productionMultiplier`, `costMultiplier`, `durationMultiplier`).
2. Run `npm run balance` (and `npm run balance -- --sessions 2`) until HQ 10 lands near day 85–90.
3. Run `npm test` — content tests assert monotonic tables and valid PvE/territory layouts.
4. For live servers, prefer tunables (audited, reversible). A tunables change takes effect immediately for new
   actions; running timers keep the duration they were started with.
