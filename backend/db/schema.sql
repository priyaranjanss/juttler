-- Juttler database schema (Neon Postgres)
-- Run with: npm run db:migrate

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  clerk_id      TEXT UNIQUE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  avatar        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bots (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  role_title         TEXT NOT NULL,
  system_prompt      TEXT NOT NULL DEFAULT '',
  avatar             TEXT NOT NULL DEFAULT 'Ã°Å¸Â¤â€“',
  color              TEXT NOT NULL DEFAULT '#6366f1',
  allowed_tools      JSONB NOT NULL DEFAULT '["web_search"]',
  is_chief_of_staff  BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'waiting_approval')),
  memory_enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bots_user ON bots(user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  is_group             BOOLEAN NOT NULL DEFAULT false,
  participant_bot_ids  JSONB NOT NULL DEFAULT '[]',
  last_message_snippet TEXT,
  last_message_at      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type    TEXT NOT NULL CHECK (sender_type IN ('user', 'bot', 'system')),
  sender_id      TEXT NOT NULL,
  sender_name    TEXT,
  sender_avatar  TEXT,
  sender_color   TEXT,
  content        TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'text',
  metadata       JSONB,
  timestamp      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);

CREATE TABLE IF NOT EXISTS approvals (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id           TEXT NOT NULL,
  bot_name         TEXT NOT NULL,
  conversation_id  TEXT,
  action_name      TEXT NOT NULL,
  tool_name        TEXT NOT NULL,
  tool_params      JSONB NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason           TEXT,
  rejection_reason TEXT,
  created_time     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_time    TIMESTAMPTZ,
  resolved_by      TEXT
);
CREATE INDEX IF NOT EXISTS idx_approvals_user ON approvals(user_id, created_time DESC);

CREATE TABLE IF NOT EXISTS skills (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  input_parameters JSONB NOT NULL DEFAULT '[]',
  instructions     TEXT NOT NULL,
  allowed_tools    JSONB NOT NULL DEFAULT '["web_search"]',
  success_criteria TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id);

CREATE TABLE IF NOT EXISTS routines (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id       TEXT NOT NULL,
  skill_name     TEXT,
  bot_id         TEXT NOT NULL,
  bot_name       TEXT,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  trigger_type   TEXT NOT NULL DEFAULT 'cron',
  trigger_config JSONB NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  last_run       TIMESTAMPTZ,
  last_result    JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);

CREATE TABLE IF NOT EXISTS memories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id     TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'fact',
  text       TEXT NOT NULL,
  importance INT NOT NULL DEFAULT 3,
  tags       JSONB NOT NULL DEFAULT '["custom"]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);

CREATE TABLE IF NOT EXISTS activity_logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  user_name       TEXT,
  bot_id          TEXT,
  bot_name        TEXT,
  conversation_id TEXT,
  event_type      TEXT NOT NULL,
  description     TEXT NOT NULL,
  details         JSONB,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS tool_call_logs (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  bot_id              TEXT NOT NULL,
  bot_name            TEXT,
  tool_name           TEXT NOT NULL,
  input_args          JSONB NOT NULL DEFAULT '{}',
  output_result       JSONB,
  status              TEXT NOT NULL DEFAULT 'success',
  duration_ms         INT NOT NULL DEFAULT 0,
  timestamp           TIMESTAMPTZ NOT NULL DEFAULT now(),
  token_cost_estimate DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_toollogs_user ON tool_call_logs(user_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS global_settings (
  id                                  BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  default_sensitive_tools             JSONB NOT NULL DEFAULT '["github_merge_pr", "slack_send_message", "jira_change_status", "code_interpreter_danger"]',
  require_approval_for_external_posts BOOLEAN NOT NULL DEFAULT true,
  max_execution_steps_per_plan        INT NOT NULL DEFAULT 6,
  token_cost_per_million              DOUBLE PRECISION NOT NULL DEFAULT 0.15
);

-- Per-bot AI provider wiring (added after the first release).
-- Uses ADD COLUMN IF NOT EXISTS so re-running `npm run db:migrate` upgrades an
-- existing database in place.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS ai_provider TEXT NOT NULL DEFAULT 'kilo_gateway';
ALTER TABLE bots ADD COLUMN IF NOT EXISTS ai_endpoint TEXT NOT NULL DEFAULT 'https://api.kilo.ai/api/gateway';
-- No default on purpose: the model is chosen per bot in bot settings.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS ai_model TEXT;
ALTER TABLE bots ALTER COLUMN ai_model DROP NOT NULL;
ALTER TABLE bots ALTER COLUMN ai_model DROP DEFAULT;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS ai_api_key  TEXT;

-- Grok-style reasoning modes: think, big_brain, off
ALTER TABLE bots ADD COLUMN IF NOT EXISTS reasoning_mode TEXT NOT NULL DEFAULT 'off'
  CHECK (reasoning_mode IN ('think', 'big_brain', 'off'));

-- ---------------------------------------------------------------------------
-- Plugins: structured integrations that give Bots access to external services.
-- A Plugin definition is account-wide (the marketplace catalog). Once a user
-- connects it, every Bot they own can use it, and each Bot can enable or
-- disable individual tools.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS plugins (
  id          TEXT PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'Other',
  is_official BOOLEAN NOT NULL DEFAULT true,
  -- 'token' = paste an access token; 'oauth' = OAuth 2.0 redirect flow
  auth_type   TEXT NOT NULL DEFAULT 'token',
  -- Array of tool definitions:
  --   [{ name, description, parameters: <JSON Schema>, sensitive: boolean }]
  tools               JSONB NOT NULL DEFAULT '[]',
  required_credentials JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plugins_slug ON plugins(slug);

-- Added after the first release: what each plugin asks the user for.
ALTER TABLE plugins ADD COLUMN IF NOT EXISTS required_credentials JSONB NOT NULL DEFAULT '[]';
-- Plugin marks are now drawn by the frontend from the slug, so this is unused.
ALTER TABLE plugins DROP COLUMN IF EXISTS logo;

-- One row per user per plugin. Tokens are encrypted at rest and never leave
-- the backend (see services/tokenCrypto.ts).
CREATE TABLE IF NOT EXISTS plugin_installations (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id        TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'needs_reauth')),
  -- Encrypted credential material (never returned to the client)
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at TIMESTAMPTZ,
  -- Extra account info shown in the UI (e.g. GitHub login) Ã¢â‚¬â€ no secrets here
  metadata         JSONB NOT NULL DEFAULT '{}',
  connected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plugin_installations_unique UNIQUE (user_id, plugin_id)
);
CREATE INDEX IF NOT EXISTS idx_plugin_installations_user ON plugin_installations(user_id);

-- Which tools of an installed plugin a specific Bot is allowed to call.
CREATE TABLE IF NOT EXISTS bot_plugin_access (
  id              TEXT PRIMARY KEY,
  bot_id          TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE,
  enabled_tools   TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bot_plugin_access_unique UNIQUE (bot_id, installation_id)
);
CREATE INDEX IF NOT EXISTS idx_bot_plugin_access_bot ON bot_plugin_access(bot_id);

-- Rename leftover "Chief of Staff" naming to "Chief".
-- Code changes only affect the default for NEW bots, so existing rows need this.
UPDATE bots SET role_title = 'Chief' WHERE role_title = 'Chief of Staff';
UPDATE bots SET name        = 'Chief' WHERE name        = 'Chief of Staff';

-- Slack threads are real conversations, but they must not replace the bot's
-- main in-app chat. 'app' is the chat opened from the sidebar.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app';

-- A Team Bot belongs to one team. Personal bots stay team-less and keep using
-- the Slack plugin (they post as the user). The dedicated Slack app is team-only.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS team_id TEXT;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_team_bot BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS teams (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  id              TEXT PRIMARY KEY,
  team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'member')),
  slack_user_id   TEXT,
  slack_team_id   TEXT,
  slack_display_name TEXT,
  slack_linked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_members_unique UNIQUE (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- One Slack app per Team Bot. Secrets are encrypted the same way as plugin tokens.
CREATE TABLE IF NOT EXISTS slack_bot_apps (
  id                      TEXT PRIMARY KEY,
  bot_id                  TEXT NOT NULL UNIQUE REFERENCES bots(id) ON DELETE CASCADE,
  team_id                 TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slack_team_id           TEXT,
  slack_team_name         TEXT,
  slack_app_id            TEXT,
  client_id               TEXT,
  client_secret           TEXT,
  signing_secret          TEXT,
  bot_token               TEXT,
  bot_user_id             TEXT,
  installer_user_id       TEXT,
  installer_slack_user_id TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending_install'
    CHECK (status IN ('pending_install', 'awaiting_admin_approval', 'connected', 'error')),
  status_detail           TEXT,
  welcome_dm_sent         BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slack_bot_apps_slack_app ON slack_bot_apps(slack_app_id);

-- One row per Slack DM (thread_key '') or per channel thread.
CREATE TABLE IF NOT EXISTS slack_threads (
  id              TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES slack_bot_apps(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  channel_id      TEXT NOT NULL,
  thread_key      TEXT NOT NULL DEFAULT '',
  channel_type    TEXT NOT NULL,
  activated       BOOLEAN NOT NULL DEFAULT false,
  link_prompted   BOOLEAN NOT NULL DEFAULT false,
  title           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS slack_threads_lookup
  ON slack_threads (installation_id, channel_id, thread_key);

-- Slack retries events and also emits both app_mention and message for one post.
CREATE TABLE IF NOT EXISTS slack_event_receipts (
  event_id    TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slack_message_receipts (
  installation_id TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  message_ts      TEXT NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, channel_id, message_ts)
);

-- A bot has no computer. These two fields are the only places it may work:
-- one Jira project, and the GitHub repositories it may read and change.
ALTER TABLE bots ADD COLUMN IF NOT EXISTS jira_project TEXT;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS github_repos JSONB NOT NULL DEFAULT '[]';
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS slack_display_name TEXT;
