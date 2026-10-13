# Mini Empire

A mobile-first medieval strategy game: build a kingdom, train an army, fight asynchronous battles, join a clan,
fight for territories and compete in a 100-day season. Web first, structured for a Telegram Mini App and
future Android/iOS clients.

> **Status:** playable foundation covering development phases 1–7 (see [What works](#what-works)).
> Everything listed as working is implemented end-to-end and covered by automated tests or was exercised
> in a real browser. Known gaps are listed honestly in [Limitations](#known-limitations).

---

## Technology choices

| Layer | Choice | Why |
|---|---|---|
| Game rules | `shared/` — pure TypeScript, no I/O | Same rules run on the server (authoritative) and in the browser (previews, battle replays). Ready to reuse in native clients. |
| Server | Node 22 + Fastify 5 + `pg` + Zod | Small, fast, explicit SQL with real transactions; Zod validates every request. |
| Database | PostgreSQL 16, plain SQL migrations | Row locks + transactions for every economic action; CHECK constraints as a second line of defence. |
| Client | React 18 + Vite 6, SVG isometric renderer | No heavy game engine: procedural SVG art scales crisply on phones and is easy to replace with illustrated assets. |
| Tests | Vitest (unit tests on rules, integration tests on a real PostgreSQL) | |
| Auth | Opaque bearer sessions (SHA-256 hashed at rest), scrypt passwords, Telegram `initData` HMAC verification | Bearer tokens work inside Telegram's web view where cookies are unreliable. |

## Project structure

```
mini-empire/
├── shared/                 # @mini-empire/shared — game rules & balancing (no I/O)
│   ├── src/config/         # buildings, troops, economy, missions, season, scoring, rewards, territories, PvE
│   ├── src/rules/          # kingdom (placement, upgrades, production), training, resources, periods
│   ├── src/battle/         # deterministic battle engine + seeded RNG
│   ├── src/season/         # 100-day season state machine
│   ├── src/scoring/        # leaderboards, war matchmaking, reward calculation
│   ├── scripts/balance-sim.ts  # plays a "regular player" through the real rules (days to HQ 10)
│   └── test/               # unit tests
├── server/                 # @mini-empire/server — Fastify API (authoritative)
│   ├── migrations/         # SQL migrations (schema in 001_init.sql)
│   ├── src/routes/         # auth, kingdom/army, battles, missions, clans, world, season, profile/store, admin
│   ├── src/services/       # kingdom persistence, battles, clan wars, territories, season, rewards, leaderboards
│   ├── src/auth/           # passwords, sessions, Telegram verification
│   ├── scripts/grant-role.ts
│   └── test/               # integration tests (real PostgreSQL)
├── client/                 # @mini-empire/client — React UI
│   └── src/{screens,components,render}
├── docs/                   # architecture, API, economy, game rules, security, deployment, roadmap
├── Dockerfile, docker-compose.yml, .github/workflows/ci.yml, .env.example
```

## Quick start (clean machine)

Requirements: **Node.js ≥ 20** (22 recommended). PostgreSQL ≥ 14 is recommended for production; for local play
the server uses a built-in embedded PostgreSQL (PGlite, stored in `./data`) when `DATABASE_URL` is empty.

```bash
# 1. Install dependencies (npm workspaces)
npm install

# 2. Create databases (adapt user/password)
createuser -P mini            # password e.g. mini_dev_password
createdb -O mini mini_empire
createdb -O mini mini_empire_test

# 3. Configure (the root .env file is loaded automatically)
cp .env.example .env          # edit DATABASE_URL / TEST_DATABASE_URL

# 4. Migrate (the server also migrates automatically on start)
npm run migrate

# 5. Run in development: API on :3000 + Vite dev server on :5173 (proxies /api)
npm run dev
# open http://localhost:5173 and create a kingdom
```

### Windows + VS Code

**Shortcut:** after installing Node.js, double-click `baslat.bat` (play in the browser) or `telegram-baslat.bat`
(play inside Telegram through a free Cloudflare tunnel — see [docs/TELEGRAM_KURULUM.md](docs/TELEGRAM_KURULUM.md)).
No PostgreSQL installation is needed for local play.

Manual steps:

1. Install **Node.js 22 LTS** (nodejs.org), **PostgreSQL 16** (postgresql.org/download/windows — note the password
   you choose for the `postgres` user), **Git** and **VS Code**.
2. In VS Code: *Terminal → New Terminal* (PowerShell), then:
   ```powershell
   git clone -b claude/mini-empire-strategy-game-8k1bxl https://github.com/lileren063-debug/Mini-empire.git
   cd Mini-empire
   npm install
   ```
3. Create the database user and databases (PostgreSQL's `bin` folder, e.g. `C:\Program Files\PostgreSQL\16\bin`, must be on PATH):
   ```powershell
   psql -U postgres -c "CREATE USER mini WITH PASSWORD 'mini_dev_password' CREATEDB;"
   psql -U postgres -c "CREATE DATABASE mini_empire OWNER mini;"
   psql -U postgres -c "CREATE DATABASE mini_empire_test OWNER mini;"
   ```
4. Copy the settings file: `Copy-Item .env.example .env`, then edit `.env` and set
   `DATABASE_URL=postgres://mini:mini_dev_password@localhost:5432/mini_empire` and
   `TEST_DATABASE_URL=postgres://mini:mini_dev_password@localhost:5432/mini_empire_test`.
   (`.env` is read automatically — no need to set environment variables by hand.)
5. Run:
   ```powershell
   npm run migrate
   npm run dev
   ```
   Open **http://localhost:5173**. Stop with `Ctrl+C`. Optional: `npm test` (64 tests).

Production-like run (API serves the built client on one port):

```bash
npm run build      # builds client/dist
npm start          # http://localhost:3000
```

Or with Docker: `docker compose up --build` → http://localhost:3000.

### Creating an administrator

There is intentionally **no HTTP endpoint that can create the first admin**. Register a normal account in the
game, then on the server:

```bash
npm run admin:grant -w server -- <username> superadmin   # roles: player | moderator | admin | superadmin
```

The admin panel is then reachable from the profile menu (tap your avatar → *Admin panel*).

### Useful commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests (shared) + integration tests (server, needs `TEST_DATABASE_URL`; **drops & recreates that DB's schema**) |
| `npm run typecheck` | Type-checks all three packages |
| `npm run balance` | Balance simulation: days for a regular player to reach each HQ level (`-- --sessions 2`, `-- --table`) |
| `npm run migrate` | Applies pending SQL migrations |
| `npm run build` | Production build of the client |

## Test results

Last run in the development container (Node 22.22, PostgreSQL 16.15):

```
shared  Test Files 5 passed (5)   Tests 39 passed (39)
server  Test Files 3 passed (3)   Tests 25 passed (25)
typecheck: shared, server, client — clean
client build: 273 kB JS (85 kB gzip)
```

What the tests prove (selection):

* Starting kingdom is exactly HQ 1 + one defensive tower + one wall; placement rejects overlap, out-of-bounds, water and the deploy ring.
* Upgrades need resources, HQ level, prerequisites and a free builder; costs are deducted atomically; timers complete only on server time.
* Offline production uses server timestamps, stops at the buffer cap and the 24 h window, is limited by storage, and **four concurrent collect requests credit exactly one collection**.
* Idempotency keys replay the stored response instead of executing twice; reusing a key with another body is rejected.
* Training queue: costs, per-unit completion, capacity, cancellation refunds.
* Battles are deterministic; a client sending `victory: true`, fake rewards or troops it does not own gets nothing extra; there is no endpoint to add resources or submit results; stored battles can be re-simulated and **tampering with a stored result is detected**.
* Missions: progress comes only from server events; **three concurrent claims → exactly one succeeds**; daily reset in UTC; participation capped per day.
* Clans: no double membership, role permissions (member/officer/leader), closed-clan approvals.
* Season: correct phase for every day, only forward single-step transitions, roster lock at war start, matchmaking, war attacks limited to locked rosters, scores frozen after the war phase.
* Rewards: preview → approve → distribute; re-approving/re-running distribution never pays twice; never exceeds the pool.
* Season reset: atomic, idempotent (second run is a no-op), resets kingdoms/troops/territories and **preserves** accounts, token balances, achievements, cosmetics, clan history, leaderboard snapshots and season records.
* Unauthenticated / non-admin requests are refused; public profiles leak no private fields; Telegram `initData` with a wrong signature, wrong bot or stale date is rejected.

Also verified manually in headless Chromium (390×844 phone and 1280×800 desktop): registration, onboarding,
build shop, valid/invalid placement ghost, upgrades panel, campaign battle with replay and result, world map,
clan creation form, season screen. The Docker image was built and run against PostgreSQL (registration and
client serving worked).

## What works

**Phase 1 — Kingdom prototype:** isometric 24×24 kingdom with pan/zoom/pinch, tap selection, building info
panel, shop, placement with live validity, move, upgrade, cancel (50 % refund), level badges, construction
scaffolding + timers, 10 visually distinct levels per building (wood → reinforced timber → stone → fortified
masonry → royal → legendary), resource bar, season countdown, bottom navigation, onboarding.

**Phase 2 — Economy & persistence:** accounts (username/password, Telegram), server-side kingdom state, resource
production (offline, capped), collection, storage limits, construction queue with builders, prerequisites,
audit log of every balance change, idempotent mutations, row-locked transactions, data-driven balancing
tables + admin tunables.

**Phase 3 — Army & battles:** single Barracks with unlocks, capacity, training queue, cancellation; four troop
classes with target priorities and damage modifiers; deterministic tick-based battle engine with walls
(path-finding cost + break-through), archer towers (nearest) and heavy towers (strongest, splash); 10 PvE
stages, PvP with matchmaking, loot, shields and diminishing returns; battle reports, history and replays.

**Phase 4 — Clans & world map:** create/join/leave, open or approval-based joining, tag/name uniqueness, emblem,
description, leader/officer/member roles with enforced permissions, kick, promote/demote, leadership transfer,
polling chat, clan missions with contribution tracking, contribution stats, clan history, season results;
14-territory world map with ownership, history, capture cooldowns, attempt limits and hourly hold scoring.

**Phase 5 — Seasons & rankings:** 100-day server-time state machine, automatic transitions, roster selection,
eligibility and lock, strength/activity matchmaking with byes, war battles and results, clan / individual /
participation leaderboards with published tie-breaks, final snapshots, permanent per-player season records,
atomic idempotent season reset with archives.

**Phase 6 — Rewards & administration:** simulated token ledger (pool, configurable allocation, eligibility,
preview, approval, idempotent distribution, failure + retry, history), admin panel (overview/health/errors,
player & clan lookup, progression inspection, balancing tunables with history, season control, war &
leaderboard inspection, reward workflow, suspicious-activity review, audit log), role-based permissions.

**Phase 7 — Telegram & mobile readiness:** verified Telegram Mini App login, safe-area aware responsive layout,
Dockerfile, docker-compose, CI workflow, deployment guide, path to native clients (see docs/DEPLOYMENT.md).

## Known limitations

* **Art** is procedural SVG (deliberately replaceable via `client/src/render/sprites.tsx`); no sound or music.
* **Chat** uses 4-second polling, not WebSockets.
* **Rate limiting** is in-memory (single instance). Use a shared store (e.g. Redis) before scaling horizontally.
* **Season reset** runs in one transaction over all kingdoms — fine for thousands of players; batch it for very large populations.
* **Defending troops** do not fight in battles (only towers and walls defend). Troop levels are tied to Barracks level rather than individual research.
* **Replays** re-simulate with the client's current balancing; if an operator changed balancing after a battle the replay shows a notice (the stored server result stays authoritative).
* **Store**: catalogue and inventory exist; real payments are deliberately disabled (`PAYMENTS_DISABLED`).
* **Tokens** are a simulated ledger only. There is no blockchain integration, no price and no financial promise.
* **Telegram**: server verification and client bootstrap are implemented and unit-tested with signed data, but have not been tested inside the real Telegram app (needs a bot token and public HTTPS URL).
* The balance targets HQ 10 in ~90 days for a regular player: the simulation reaches it on **day 77** with three short sessions per day and **day 86** with two (an optimal greedy bot; real players are less efficient). Tune via `docs/ECONOMY.md`.
* No e-mail accounts / password reset yet; no automated end-to-end browser test suite in CI (manual Playwright run only).

## Documentation

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, data flow, invariants
* [docs/API.md](docs/API.md) — every endpoint with request/response
* [docs/ECONOMY.md](docs/ECONOMY.md) — balance tables and how to tune them
* [docs/GAME_RULES.md](docs/GAME_RULES.md) — battles, clans, wars, territories, seasons, scoring, rewards
* [docs/SECURITY.md](docs/SECURITY.md) — anti-cheat, authorization, auditing, backups
* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — production, Telegram Mini App, mobile path
* [docs/ROADMAP.md](docs/ROADMAP.md) — next development phase
