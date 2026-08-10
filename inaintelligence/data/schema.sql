-- InaIntelligence schema (Postgres / Neon)
-- Run once via: npm run seed  (creates tables + seed data)

CREATE TABLE IF NOT EXISTS super_admins (
  id            text PRIMARY KEY,
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  type               text NOT NULL DEFAULT 'sales',
  module_kind        text NOT NULL DEFAULT 'pipeline',   -- 'pipeline' (CRM-style) or 'counters' (ERP-style)
  pipeline_label     text NOT NULL DEFAULT 'Leads',
  statuses           text[] NOT NULL DEFAULT ARRAY['New','Contacted','Hot','Cold','Converted'],
  metrics            jsonb NOT NULL DEFAULT '[]',        -- [{key,label}] — which counters this account type exposes
  counters           jsonb NOT NULL DEFAULT '{}',        -- {key: number} — current counter values (ERP-style only)
  status             text NOT NULL DEFAULT 'active',
  credit_limit       integer NOT NULL DEFAULT 5000,
  credits_used       integer NOT NULL DEFAULT 0,
  actions_triggered  integer NOT NULL DEFAULT 0,
  license_number     text UNIQUE,                        -- e.g. INA-7F3K-9XQ2
  license_term_months integer NOT NULL DEFAULT 12,
  starts_at          timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz
);

-- safe to re-run even if the table already existed from an earlier version
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS module_kind text NOT NULL DEFAULT 'pipeline';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '[]';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS counters jsonb NOT NULL DEFAULT '{}';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS license_number text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS license_term_months integer NOT NULL DEFAULT 12;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS starts_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS expires_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_license_number_key') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_license_number_key UNIQUE (license_number);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS team_members (
  id            text PRIMARY KEY,
  account_id    text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          text NOT NULL,
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  is_primary    boolean NOT NULL DEFAULT false,
  role          text NOT NULL DEFAULT 'User'  -- display label only: 'Admin' for the primary admin, 'User' for everyone else
);
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'User';
-- normalize any accounts seeded before the role system was simplified to Admin/User
UPDATE team_members SET role = CASE WHEN is_primary THEN 'Admin' ELSE 'User' END WHERE role NOT IN ('Admin', 'User');

CREATE TABLE IF NOT EXISTS leads (
  id             text PRIMARY KEY,
  account_id     text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name           text NOT NULL,
  company        text NOT NULL,
  status         text NOT NULL,
  source         text NOT NULL,
  value          integer NOT NULL DEFAULT 0,
  owner_id       text REFERENCES team_members(id) ON DELETE SET NULL,
  last_contacted text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS value integer NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_id text REFERENCES team_members(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS activity (
  id         text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text       text NOT NULL,
  actor_name text,                  -- who triggered this (null for pure system events)
  lead_id    text REFERENCES leads(id) ON DELETE SET NULL,  -- set for lead-specific events
  at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE activity ADD COLUMN IF NOT EXISTS actor_name text;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS lead_id text REFERENCES leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_activity_lead ON activity(lead_id);

CREATE TABLE IF NOT EXISTS tasks (
  id            text PRIMARY KEY,
  account_id    text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  assignee_id   text REFERENCES team_members(id) ON DELETE CASCADE,
  assignee_name text NOT NULL,
  created_by    text NOT NULL,
  kind          text NOT NULL DEFAULT 'task',   -- 'task' or 'reminder'
  title         text NOT NULL,
  status        text NOT NULL DEFAULT 'pending', -- 'pending' or 'done'
  due_at        timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_account ON leads(account_id);
CREATE INDEX IF NOT EXISTS idx_tasks_account ON tasks(account_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_activity_account ON activity(account_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_team_account ON team_members(account_id);

-- express-session's connect-pg-simple table (created automatically by the
-- library too, but declared here so `npm run seed` sets it up in one pass)
CREATE TABLE IF NOT EXISTS session (
  sid    varchar NOT NULL COLLATE "default",
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
) WITH (OIDS=FALSE);

ALTER TABLE session DROP CONSTRAINT IF EXISTS session_pkey;
ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
