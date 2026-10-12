# Game rules

## Kingdom

* 24×24 isometric grid. The outer ring is the attackers' deploy zone; a pond and a rock outcrop are unbuildable.
* New players start with exactly: **Headquarters 1**, **Archer Tower 1**, **one Wall 1** and 1 500 gold,
  1 500 wood, 500 stone.
* Buildings: Headquarters, Gold Mine, Lumber Camp, Stone Quarry, Storage, Barracks, Archer Tower, Heavy Tower, Wall.
  Each has 10 levels with distinct visuals (wood → reinforced timber → stone → fortified masonry → royal → legendary).
* Construction uses a builder (1 → 3 builders with HQ level); walls are built instantly at level 1.
* Buildings can be moved for free at any time; constructions can be cancelled for a 50 % refund.

## Battles

* Asynchronous: the defender never needs to be online. Only towers and walls defend.
* Choose how many of each troop to send and from which side. The server picks the random seed and resolves
  the battle with the deterministic engine; the client then replays it.
* Stars: ★ 50 % destruction (walls excluded), ★ Headquarters destroyed, ★ 100 % destruction. Victory = ≥ 1 star.
* Fallen troops are lost; survivors return. Battles last at most 3 minutes.
* **Campaign (PvE):** 10 stages, each unlocked by the previous stage and an HQ level. Rewards for the first three
  attempts per stage per UTC day.
* **Player battles (PvP):** opponents within ±2 HQ levels, not in your clan, not shielded. Loot is taken from the
  defender's stored resources. The defender gets a 4 h shield. Repeat attacks on the same player within 24 h give
  100 % / 50 % / 25 % of the points and are refused after the third.

## Clans

* One clan per player (enforced by the database). Name and tag are unique (case-insensitive).
* Roles: **leader** (everything), **officer** (approve requests, kick members, edit settings and the war roster),
  **member**. Only the leader promotes/demotes or transfers leadership; the leader cannot leave without
  transferring (unless they are the last member, which disbands the clan). Max 30 members.
* Clan missions: weekly shared goals fed by members' validated actions; every member who contributed can claim.
* Clan history (joins, promotions, wars, captures, season results) is permanent.

## Clan wars

**Before the war (days 1–93):** leaders/officers choose a roster of eligible members.

* Eligible: HQ ≥ 5, member of the clan for ≥ 48 h at roster lock, not suspended. Roster size 3–20.

**Roster lock (start of day 94, automatic):**

1. Unlocked roster entries are re-validated; ineligible entries are removed and logged in the clan history.
2. Clans with fewer than 3 valid players are not entered (logged).
3. Remaining entries are locked with a power snapshot. No roster changes are possible afterwards — rosters are
   the official record.
4. Matchmaking: each clan's rating = average member power × (0.5 + 0.5 × share of members active in the last
   7 days) × √roster size. Clans are sorted by rating and paired with their neighbour, so strength and activity
   matter, not just size. With an odd number of clans the lowest-rated gets a **bye** (no points, no loss).

**War (days 94–98):** each roster member has 3 attacks against the enemy roster. Only the **best** result
against each enemy player counts (10 points per star).

**Result (start of day 99):** more points wins; tie → higher total destruction; still tied → draw. Win = +150
clan score, draw = +50 (a war where neither side scored is a "no contest": no bonus). Inactive roster players
simply contribute nothing (a fully inactive clan effectively forfeits). Disputes: every war battle stores its
seed and inputs and can be re-simulated by staff (`/admin/battles/:id/verify`); decisions are audited.

## Territories

* 14 territories (neutral, resource, strategic, event) with value 1–4 and an NPC garrison.
* Attackable only during the war phase, by clan members with HQ ≥ 3; 2 attempts per player per territory per day.
* ≥ 2 stars captures the territory for your clan. A captured territory is protected for 6 h and its garrison gets
  +1 level while owned.
* Scoring: capture = 40 individual points + 60 × value clan points; holding = 2 × value clan points per hour
  during the war phase (credited once, at the end of the war phase).

## The 100-day season

| Days | State | What happens |
|---|---|---|
| 1–90 | `DEVELOPMENT` | Build, battle, missions; rosters can be prepared |
| 91–93 | `WAR_PREPARATION` | Final roster selection |
| 94–98 | `WAR_ACTIVE` | Rosters locked + matchmaking at the start; clan wars and territory battles |
| 99–100 | `RESULT_VERIFICATION` | Wars/territories finalised, final leaderboard snapshots, scores frozen, anti-cheat review, reward preview |
| – | `REWARD_DISTRIBUTION` | Entered only when a superadmin approves the reward preview |
| – | `SEASON_RESET` → `COMPLETED` | Operator-triggered reset; the next season starts in `DEVELOPMENT` |

* Times are server UTC. Transitions are only ever single forward steps; invalid transitions are rejected.
* The schedule is configurable per season, but a published season keeps its schedule unless a superadmin
  changes it with a reason (audited) — and only before the war phase.
* If verification takes longer than day 100 the season simply waits in `RESULT_VERIFICATION`; nothing is
  distributed or reset automatically.

### Season reset

One database transaction, idempotent (`season_reset_log` has one row per season):

* **Backed up** first: every kingdom (balances, buildings, constructions, troops, training) into `season_archives`.
* **Reset:** buildings, resources, troops, training/constructions, territory ownership, clan contribution counters.
  Every kingdom returns to the starting layout.
* **Preserved:** accounts, profiles and battle record, verified (simulated) token balances, cosmetics,
  achievements and titles, clan membership and history, season participant records, leaderboard snapshots,
  battle history, audit logs.
* Season rewards granted in the same transaction: "Seasoned" achievement (HQ ≥ 3) and the Champion Crown frame
  for members of the top clan.

## Scoring & leaderboards

Points exist only as `score_events` rows created by the server, each with a unique source reference — the same
battle, mission or capture can never be counted twice. Scores stop counting when the season leaves
`WAR_ACTIVE`.

| Board | Sources |
|---|---|
| Individual (battle) | 10 pts/star PvP (with repeat-attack multiplier), 15 pts/star war, 2 pts/star campaign (rewarded attempts only), 10 pts/star territory battles, +40 per capture |
| Clan | 10 per member war star (best per defender) + win/draw bonus, 60 × value per capture, hold points, 50 per clan mission, 25 % of members' battle points |
| Participation | 5 per active day, mission claims (5 daily / 20 weekly), **capped at 40 per UTC day** |

**Tie-breaks (published in-game):** higher score → earlier time of last scoring event → older account/clan.

## Rewards (simulated)

The game never promises token prices, profits or returns. The reward ledger is a **simulation**:

* Pool and allocation are configurable per season (default illustrative split: 40 % clan, 30 % individual,
  20 % participation, 10 % special achievements & fair play).
* Eligibility: HQ ≥ 3 at verification, not suspended, not under review. Clan pool: top 20 clans by score, split
  by score, then inside each clan by member contribution. Individual pool: top 100 by battle score.
  Participation: participation score ≥ 20. Special: special achievements earned this season with no actioned
  anti-cheat case.
* Workflow: preview (admin) → approve (superadmin) → distribute. Each allocation has at most one ledger
  transaction (unique key), so distribution can be re-run safely; failures (e.g. account suspended after
  approval) are recorded and can be retried. Rounding always goes down; the remainder stays in the pool.
