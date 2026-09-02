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

-- ---------- Real Estate CRM module ----------
CREATE TABLE IF NOT EXISTS re_brokers (
  id               text PRIMARY KEY,
  account_id       text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name             text NOT NULL,
  phone            text,
  email            text,
  zone             text,
  active_leads     integer NOT NULL DEFAULT 0,
  closed_deals     integer NOT NULL DEFAULT 0,
  conversion_pct   numeric NOT NULL DEFAULT 0,
  commission_pct   text,
  sales_target     bigint NOT NULL DEFAULT 0,
  revenue_achieved bigint NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'Active',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS re_leads (
  id                text PRIMARY KEY,
  account_id        text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name              text NOT NULL,
  phone             text,
  country_code      text,
  email             text,
  source            text,
  property_interest text,
  budget            bigint NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'New',
  broker_id         text REFERENCES re_brokers(id) ON DELETE SET NULL,
  date_received     date,
  last_followup     date,
  next_followup     date,
  remarks           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS re_inventory (
  id           text PRIMARY KEY,
  account_id   text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_name text NOT NULL,
  unit_no      text,
  type         text,
  area_sqft    integer,
  price        bigint NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'Available',
  location     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS re_accounting (
  id           text PRIMARY KEY,
  account_id   text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  txn_date     date,
  client_name  text,
  property     text,
  amount       bigint NOT NULL DEFAULT 0,
  type         text,
  broker_name  text,
  payment_mode text,
  status       text NOT NULL DEFAULT 'Pending',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Site visits: scheduling/tracking for both off-plan show-unit visits and
-- secondary-market property tours. Tied to a lead, optionally a specific
-- inventory unit and the broker running the visit.
CREATE TABLE IF NOT EXISTS re_site_visits (
  id           text PRIMARY KEY,
  account_id   text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id      text REFERENCES re_leads(id) ON DELETE CASCADE,
  broker_id    text REFERENCES re_brokers(id) ON DELETE SET NULL,
  inventory_id text REFERENCES re_inventory(id) ON DELETE SET NULL,
  scheduled_at timestamptz,
  status       text NOT NULL DEFAULT 'Scheduled', -- Scheduled, Completed, Cancelled, No-show
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_re_site_visits_account ON re_site_visits(account_id);
CREATE INDEX IF NOT EXISTS idx_re_site_visits_lead ON re_site_visits(lead_id);
CREATE INDEX IF NOT EXISTS idx_re_site_visits_broker ON re_site_visits(broker_id);
CREATE INDEX IF NOT EXISTS idx_re_site_visits_scheduled ON re_site_visits(scheduled_at);

-- WhatsApp conversation log: every inbound/outbound message tied to a lead.
-- Kept separate from the generic `activity` table (which is a human-readable
-- event log) since this is a raw chat transcript the Claude agent replays as
-- context on every reply.
CREATE TABLE IF NOT EXISTS re_wa_messages (
  id             text PRIMARY KEY,
  account_id     text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id        text NOT NULL REFERENCES re_leads(id) ON DELETE CASCADE,
  direction      text NOT NULL, -- 'in' | 'out'
  message        text NOT NULL,
  wa_message_id  text, -- Meta's wamid for outbound messages, used to match async delivery-status webhooks back to this row
  status         text, -- outbound only: 'sent' | 'delivered' | 'read' | 'failed'
  status_detail  text, -- error message when status = 'failed'
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_re_wa_messages_lead ON re_wa_messages(lead_id, created_at);

-- Per-account WhatsApp Business config. Each real_estate account can run its
-- own WhatsApp number + agent persona instead of everyone sharing the single
-- WHATSAPP_TOKEN/PHONE_NUMBER_ID/AGENT_NAME/etc. in .env. Those env vars are
-- kept as a fallback for the original demo account only — see
-- db.js#resolveAccountByPhoneNumberId and whatsappClient.js.
CREATE TABLE IF NOT EXISTS re_whatsapp_config (
  account_id       text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  phone_number_id  text,       -- Meta phone_number_id for this account's WhatsApp Business number
  access_token     text,       -- Meta permanent access token for sending on that number
  business_number  text,       -- display phone number, shown in the setup UI for reference
  template_name    text,       -- approved outreach template name for this account
  template_lang    text NOT NULL DEFAULT 'en',
  agent_name       text,       -- e.g. "Zara" — this account's AI agent persona name
  business_name    text,       -- shown to leads ("...for {business_name}")
  business_context text,       -- free-text context fed into the agent's system prompt
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_re_wa_messages_account ON re_wa_messages(account_id);

-- Extra business detail fields, added after the first Real Estate CRM
-- pass so every lead/broker/unit has a fuller profile.
ALTER TABLE re_leads ADD COLUMN IF NOT EXISTS nationality text;
-- Speed-to-lead SLA: timestamp of the lead's current broker assignment.
-- Reset every time broker_id changes; used to detect leads sitting
-- untouched past the 5-minute SLA so Ina can auto-reassign them.
-- Defaults existing rows to now() on migration so turning this feature on
-- doesn't trigger an immediate mass-reassignment of already-seeded data.
ALTER TABLE re_leads ADD COLUMN IF NOT EXISTS assigned_at timestamptz DEFAULT now();
ALTER TABLE re_brokers ADD COLUMN IF NOT EXISTS license_no text;
ALTER TABLE re_brokers ADD COLUMN IF NOT EXISTS joined_at date;
ALTER TABLE re_inventory ADD COLUMN IF NOT EXISTS bedrooms integer;
ALTER TABLE re_inventory ADD COLUMN IF NOT EXISTS bathrooms integer;
ALTER TABLE re_inventory ADD COLUMN IF NOT EXISTS possession_date date;
ALTER TABLE re_inventory ADD COLUMN IF NOT EXISTS amenities text;
ALTER TABLE re_inventory ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE re_inventory ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE re_inventory ADD COLUMN IF NOT EXISTS longitude numeric;

-- WhatsApp integration: a lead's fine-grained conversation state as the
-- Claude agent tracks it (in_conversation, needs_human, booked_viewing,
-- not_interested) — separate from the human-facing pipeline `status` field,
-- though the agent nudges `status` too at key moments (e.g. booked_viewing
-- also moves status to 'Site Visit').
ALTER TABLE re_leads ADD COLUMN IF NOT EXISTS wa_conversation_stage text;

-- Property photos: public HTTPS image URLs (WhatsApp's image message API
-- requires a publicly reachable link, not a file upload), shown in the
-- Inventory add/edit form and usable by the WhatsApp agent's
-- send_property_photos tool once a lead shows interest in a listing.
ALTER TABLE re_inventory ADD COLUMN IF NOT EXISTS images text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_re_leads_phone ON re_leads(phone);
CREATE INDEX IF NOT EXISTS idx_re_leads_account ON re_leads(account_id);
CREATE INDEX IF NOT EXISTS idx_re_brokers_account ON re_brokers(account_id);
CREATE INDEX IF NOT EXISTS idx_re_inventory_account ON re_inventory(account_id);
CREATE INDEX IF NOT EXISTS idx_re_accounting_account ON re_accounting(account_id);

-- Per-item activity timelines for the Real Estate CRM (must come after
-- re_leads/re_brokers/re_inventory exist, since these reference them).
ALTER TABLE activity ADD COLUMN IF NOT EXISTS re_lead_id text REFERENCES re_leads(id) ON DELETE SET NULL;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS re_broker_id text REFERENCES re_brokers(id) ON DELETE SET NULL;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS re_inventory_id text REFERENCES re_inventory(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_activity_re_lead ON activity(re_lead_id);
CREATE INDEX IF NOT EXISTS idx_activity_re_broker ON activity(re_broker_id);
CREATE INDEX IF NOT EXISTS idx_activity_re_inventory ON activity(re_inventory_id);

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
