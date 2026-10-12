-- Mini Empire — initial schema.
-- Conventions: uuid primary keys for players' entities, timestamptz for all times (server UTC),
-- BIGINT for resources, NUMERIC(30,0) for token micro-units. CHECK constraints are a second line of
-- defence behind the game rules (e.g. balances can never go negative even if code has a bug).

-- ===================================================================== accounts
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL,
  password_hash text,
  telegram_id   bigint UNIQUE,
  role          text NOT NULL DEFAULT 'player' CHECK (role IN ('player','moderator','admin','superadmin')),
  suspended     boolean NOT NULL DEFAULT false,
  under_review  boolean NOT NULL DEFAULT false,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));
CREATE INDEX users_ip_hash ON users (ip_hash);

CREATE TABLE sessions (
  token_hash   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Permanent profile data (survives season resets).
CREATE TABLE player_profiles (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  avatar         text NOT NULL DEFAULT 'knight',
  title          text,
  equipped       jsonb NOT NULL DEFAULT '{}'::jsonb,
  battles_won    integer NOT NULL DEFAULT 0,
  battles_lost   integer NOT NULL DEFAULT 0,
  defenses_won   integer NOT NULL DEFAULT 0,
  defenses_lost  integer NOT NULL DEFAULT 0,
  onboarding_done boolean NOT NULL DEFAULT false
);

-- ===================================================================== seasons
CREATE TABLE seasons (
  id               serial PRIMARY KEY,
  number           integer NOT NULL UNIQUE,
  starts_at        timestamptz NOT NULL,
  schedule         jsonb NOT NULL,
  state            text NOT NULL DEFAULT 'DEVELOPMENT'
                   CHECK (state IN ('DEVELOPMENT','WAR_PREPARATION','WAR_ACTIVE','RESULT_VERIFICATION','REWARD_DISTRIBUTION','SEASON_RESET','COMPLETED')),
  published        boolean NOT NULL DEFAULT true,
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- At most one season that is not completed.
CREATE UNIQUE INDEX seasons_one_open ON seasons ((true)) WHERE state <> 'COMPLETED';

CREATE TABLE season_transitions (
  id         bigserial PRIMARY KEY,
  season_id  integer NOT NULL REFERENCES seasons(id),
  from_state text NOT NULL,
  to_state   text NOT NULL,
  actor_id   uuid REFERENCES users(id),
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===================================================================== kingdoms & economy
CREATE TABLE kingdoms (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  season_id      integer NOT NULL REFERENCES seasons(id),
  hq_level       integer NOT NULL DEFAULT 1,
  power          integer NOT NULL DEFAULT 0,
  shield_until   timestamptz,
  last_battle_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kingdoms_hq ON kingdoms (hq_level);

CREATE TABLE resource_balances (
  kingdom_id uuid PRIMARY KEY REFERENCES kingdoms(id) ON DELETE CASCADE,
  gold       bigint NOT NULL CHECK (gold >= 0),
  wood       bigint NOT NULL CHECK (wood >= 0),
  stone      bigint NOT NULL CHECK (stone >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit trail of every balance change.
CREATE TABLE resource_transactions (
  id          bigserial PRIMARY KEY,
  kingdom_id  uuid NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta_gold  bigint NOT NULL,
  delta_wood  bigint NOT NULL,
  delta_stone bigint NOT NULL,
  gold_after  bigint NOT NULL,
  wood_after  bigint NOT NULL,
  stone_after bigint NOT NULL,
  reason      text NOT NULL,
  ref         text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resource_transactions_user ON resource_transactions (user_id, created_at DESC);

CREATE TABLE buildings (
  id           uuid PRIMARY KEY,
  kingdom_id   uuid NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  type         text NOT NULL,
  level        integer NOT NULL CHECK (level BETWEEN 0 AND 10),
  x            integer NOT NULL,
  y            integer NOT NULL,
  stored       double precision NOT NULL DEFAULT 0 CHECK (stored >= 0),
  last_tick_at timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX buildings_kingdom ON buildings (kingdom_id);

CREATE TABLE construction_queues (
  building_id uuid PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
  kingdom_id  uuid NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  to_level    integer NOT NULL,
  started_at  timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL
);
CREATE INDEX construction_queues_kingdom ON construction_queues (kingdom_id);

-- Army: trained troop counts per kingdom.
CREATE TABLE troops (
  kingdom_id uuid NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  troop_type text NOT NULL,
  count      integer NOT NULL CHECK (count >= 0),
  PRIMARY KEY (kingdom_id, troop_type)
);

-- Barracks training queue (the Barracks itself is a row in `buildings`).
CREATE TABLE training_queue (
  id          uuid PRIMARY KEY,
  kingdom_id  uuid NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  troop_type  text NOT NULL,
  remaining   integer NOT NULL CHECK (remaining > 0),
  per_unit_ms integer NOT NULL,
  starts_at   timestamptz NOT NULL,
  unit_cost   jsonb NOT NULL
);
CREATE INDEX training_queue_kingdom ON training_queue (kingdom_id, position);

-- ===================================================================== clans
CREATE TABLE clans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  tag          text NOT NULL,
  description  text NOT NULL DEFAULT '',
  emblem       jsonb NOT NULL,
  join_policy  text NOT NULL DEFAULT 'open' CHECK (join_policy IN ('open','closed')),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  disbanded_at timestamptz
);
CREATE UNIQUE INDEX clans_name_lower ON clans (lower(name)) WHERE disbanded_at IS NULL;
CREATE UNIQUE INDEX clans_tag_upper ON clans (upper(tag)) WHERE disbanded_at IS NULL;

-- user_id is the primary key: a player can belong to at most one clan.
CREATE TABLE clan_memberships (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  clan_id      uuid NOT NULL REFERENCES clans(id),
  role         text NOT NULL CHECK (role IN ('leader','officer','member')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  contribution integer NOT NULL DEFAULT 0
);
CREATE INDEX clan_memberships_clan ON clan_memberships (clan_id);
CREATE UNIQUE INDEX clan_one_leader ON clan_memberships (clan_id) WHERE role = 'leader';

CREATE TABLE clan_join_requests (
  clan_id    uuid NOT NULL REFERENCES clans(id),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clan_id, user_id)
);

CREATE TABLE clan_messages (
  id         bigserial PRIMARY KEY,
  clan_id    uuid NOT NULL REFERENCES clans(id),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clan_messages_clan ON clan_messages (clan_id, id DESC);

-- Permanent clan history (joins, promotions, wars, season results...).
CREATE TABLE clan_events (
  id         bigserial PRIMARY KEY,
  clan_id    uuid NOT NULL REFERENCES clans(id),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  type       text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clan_events_clan ON clan_events (clan_id, id DESC);

CREATE TABLE clan_war_rosters (
  season_id  integer NOT NULL REFERENCES seasons(id),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clan_id    uuid NOT NULL REFERENCES clans(id),
  added_by   uuid REFERENCES users(id),
  added_at   timestamptz NOT NULL DEFAULT now(),
  locked     boolean NOT NULL DEFAULT false,
  power      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (season_id, user_id)
);
CREATE INDEX clan_war_rosters_clan ON clan_war_rosters (season_id, clan_id);

CREATE TABLE clan_wars (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     integer NOT NULL REFERENCES seasons(id),
  clan_a        uuid NOT NULL REFERENCES clans(id),
  clan_b        uuid REFERENCES clans(id),
  status        text NOT NULL CHECK (status IN ('active','finished','bye')),
  rating_a      double precision NOT NULL DEFAULT 0,
  rating_b      double precision NOT NULL DEFAULT 0,
  points_a      integer NOT NULL DEFAULT 0,
  points_b      integer NOT NULL DEFAULT 0,
  destruction_a integer NOT NULL DEFAULT 0,
  destruction_b integer NOT NULL DEFAULT 0,
  outcome       text CHECK (outcome IN ('A','B','DRAW','BYE')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE UNIQUE INDEX clan_wars_a ON clan_wars (season_id, clan_a);
CREATE UNIQUE INDEX clan_wars_b ON clan_wars (season_id, clan_b) WHERE clan_b IS NOT NULL;

-- ===================================================================== world map
CREATE TABLE territories (
  id             text PRIMARY KEY,
  owner_clan_id  uuid REFERENCES clans(id),
  captured_at    timestamptz,
  cooldown_until timestamptz,
  season_id      integer REFERENCES seasons(id)
);

CREATE TABLE territory_ownership_history (
  id           bigserial PRIMARY KEY,
  territory_id text NOT NULL REFERENCES territories(id),
  clan_id      uuid NOT NULL REFERENCES clans(id),
  season_id    integer NOT NULL REFERENCES seasons(id),
  battle_id    uuid,
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz
);
CREATE INDEX territory_history_t ON territory_ownership_history (territory_id, started_at DESC);
CREATE INDEX territory_history_season ON territory_ownership_history (season_id, clan_id);

-- ===================================================================== battles
CREATE TABLE battles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id      integer NOT NULL REFERENCES seasons(id),
  kind           text NOT NULL CHECK (kind IN ('pve','pvp','war','territory')),
  attacker_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  defender_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  pve_stage      integer,
  territory_id   text,
  war_id         uuid REFERENCES clan_wars(id),
  attacker_clan_id uuid,
  seed           bigint NOT NULL,
  config_version text NOT NULL,
  input          jsonb NOT NULL,
  result         jsonb NOT NULL,
  victory        boolean NOT NULL,
  stars          integer NOT NULL,
  destruction    integer NOT NULL,
  rewards        jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_points   integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX battles_attacker ON battles (attacker_id, created_at DESC);
CREATE INDEX battles_defender ON battles (defender_id, created_at DESC);
CREATE INDEX battles_pair ON battles (attacker_id, defender_id, created_at DESC);
CREATE INDEX battles_war ON battles (war_id);
CREATE INDEX battles_territory ON battles (territory_id, created_at DESC);

-- Per-participant report (attacker and defender each get one; defender sees defense logs).
CREATE TABLE battle_reports (
  battle_id  uuid NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('attacker','defender')),
  summary    jsonb NOT NULL,
  seen       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (battle_id, user_id)
);
CREATE INDEX battle_reports_user ON battle_reports (user_id, created_at DESC);

CREATE TABLE pve_progress (
  season_id        integer NOT NULL REFERENCES seasons(id),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage            integer NOT NULL,
  best_stars       integer NOT NULL DEFAULT 0,
  first_cleared_at timestamptz,
  PRIMARY KEY (season_id, user_id, stage)
);

-- ===================================================================== missions
-- Mission definitions are data-driven (shared/src/config/missions.ts + admin tunables).
CREATE TABLE mission_progress (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id text NOT NULL,
  period_key text NOT NULL,
  progress   integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  PRIMARY KEY (user_id, mission_id, period_key)
);

CREATE TABLE clan_mission_progress (
  clan_id      uuid NOT NULL REFERENCES clans(id),
  mission_id   text NOT NULL,
  period_key   text NOT NULL,
  progress     integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  PRIMARY KEY (clan_id, mission_id, period_key)
);

CREATE TABLE clan_mission_claims (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clan_id    uuid NOT NULL REFERENCES clans(id),
  mission_id text NOT NULL,
  period_key text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mission_id, period_key)
);

CREATE TABLE clan_mission_contributors (
  clan_id    uuid NOT NULL REFERENCES clans(id),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id text NOT NULL,
  period_key text NOT NULL,
  amount     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (clan_id, user_id, mission_id, period_key)
);

-- ===================================================================== scoring & leaderboards
-- Every point comes from a validated server event with a unique source reference.
CREATE TABLE score_events (
  id         bigserial PRIMARY KEY,
  season_id  integer NOT NULL REFERENCES seasons(id),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  clan_id    uuid REFERENCES clans(id),
  category   text NOT NULL CHECK (category IN ('battle','participation','clan')),
  points     integer NOT NULL CHECK (points >= 0),
  source     text NOT NULL,
  source_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX score_events_unique ON score_events (season_id, category, source_ref);
CREATE INDEX score_events_user ON score_events (season_id, category, user_id);
CREATE INDEX score_events_clan ON score_events (season_id, category, clan_id);

CREATE TABLE season_participants (
  season_id           integer NOT NULL REFERENCES seasons(id),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clan_id             uuid,
  hq_level            integer NOT NULL,
  battle_score        integer NOT NULL DEFAULT 0,
  participation_score integer NOT NULL DEFAULT 0,
  battle_rank         integer,
  participation_rank  integer,
  clan_rank           integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, user_id)
);

CREATE TABLE leaderboard_snapshots (
  id         bigserial PRIMARY KEY,
  season_id  integer NOT NULL REFERENCES seasons(id),
  board      text NOT NULL CHECK (board IN ('clan','individual','participation')),
  reason     text NOT NULL,
  entries    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX leaderboard_snapshots_final ON leaderboard_snapshots (season_id, board) WHERE reason = 'final';

-- ===================================================================== simulated token rewards
CREATE TABLE reward_pools (
  id          serial PRIMARY KEY,
  season_id   integer NOT NULL UNIQUE REFERENCES seasons(id),
  total_units numeric(30,0) NOT NULL CHECK (total_units >= 0),
  allocation  jsonb NOT NULL,
  status      text NOT NULL CHECK (status IN ('draft','previewed','approved','distributed','partially_failed')),
  simulated   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE TABLE reward_allocations (
  id         bigserial PRIMARY KEY,
  pool_id    integer NOT NULL REFERENCES reward_pools(id),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   text NOT NULL CHECK (category IN ('clan','individual','participation','special')),
  units      numeric(30,0) NOT NULL CHECK (units > 0),
  basis      text NOT NULL,
  status     text NOT NULL CHECK (status IN ('preview','approved','distributed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pool_id, user_id, category)
);

-- Ledger. allocation_id is UNIQUE so an allocation can be credited at most once.
CREATE TABLE reward_transactions (
  id            bigserial PRIMARY KEY,
  allocation_id bigint NOT NULL UNIQUE REFERENCES reward_allocations(id),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  units         numeric(30,0) NOT NULL,
  status        text NOT NULL CHECK (status IN ('pending','completed','failed')),
  attempts      integer NOT NULL DEFAULT 0,
  external_ref  text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Verified (simulated) token balance. Permanent: survives season resets.
CREATE TABLE token_balances (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  units      numeric(30,0) NOT NULL DEFAULT 0 CHECK (units >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ===================================================================== permanent progression
CREATE TABLE achievements (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id text NOT NULL,
  season_id      integer REFERENCES seasons(id),
  earned_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE cosmetic_inventory (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_id text NOT NULL,
  source      text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cosmetic_id)
);

-- ===================================================================== season reset
CREATE TABLE season_reset_log (
  season_id    integer PRIMARY KEY REFERENCES seasons(id),
  status       text NOT NULL CHECK (status IN ('completed')),
  actor_id     uuid REFERENCES users(id),
  stats        jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

-- Backup of every kingdom taken inside the reset transaction (restorable).
CREATE TABLE season_archives (
  season_id integer NOT NULL REFERENCES seasons(id),
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot  jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, user_id)
);

-- ===================================================================== operations
CREATE TABLE game_config (
  id         serial PRIMARY KEY,
  tunables   jsonb NOT NULL,
  note       text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  target_type text,
  target_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_logs_created ON admin_audit_logs (created_at DESC);

CREATE TABLE suspicious_events (
  id            bigserial PRIMARY KEY,
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('low','medium','high')),
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  reviewed_by   uuid REFERENCES users(id),
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz
);
CREATE INDEX suspicious_events_status ON suspicious_events (status, created_at DESC);

CREATE TABLE idempotency_keys (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key          text NOT NULL,
  request_hash text NOT NULL,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE error_logs (
  id         bigserial PRIMARY KEY,
  level      text NOT NULL,
  message    text NOT NULL,
  context    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
