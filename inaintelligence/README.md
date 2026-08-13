# InaIntelligence — internal login + dashboards (prototype)

A standalone Node/Express app for the InaIntelligence login page, the
super admin console, and admin-level department dashboards (Sales CRM
and Real Estate CRM so far). Data is stored in a real Postgres
database (Neon), so it survives restarts.

## 1. Create your free Neon database

1. Go to [neon.tech](https://neon.tech) and sign up (free, no card needed).
2. Create a new project — any name is fine (e.g. "inaintelligence").
3. On the project dashboard, copy the **connection string** shown
   (starts with `postgresql://...`).

## 2. Configure the app

```
cd inaintelligence
copy .env.example .env        (Windows)
cp .env.example .env          (Mac/Linux)
```

Open `.env` and paste your Neon connection string into `DATABASE_URL`.

## 3. Install, seed, and run

```
npm install
npm run seed     (creates the tables + your super admin login — only needed once)
npm start
```

Open http://localhost:4100

## Login (seeded)

Only one login exists out of the box — you (inatron@kinesys.net,
password set in `data/seed.js` — not printed here since this is
going live). Change it in `data/seed.js` before re-seeding if you
want a different one, and treat that file as sensitive since it
now holds a real password.

Everything else — every Sales CRM account, every admin user — gets
created by you from the super admin console. There's no other seed
data on purpose.

## How to create your first Sales CRM account

1. Log in as the super admin.
2. On `/super-admin.html`, click **+ New account**.
3. Fill in: account name (e.g. "Sales — Priya Sharma"), module type
   (Sales CRM — the only option for now), the first admin's name,
   username, and a temporary password.
4. Click **Create account**. That admin can now log in and use their
   dashboard — pipeline, automations, leads — right away, and can add
   up to 2 more teammates themselves (3 total). You can add more than
   that from your side any time via "View →" on that account.

## What's in here

- **Login** (`/login.html`) — full-bleed split layout with the KineSys
  logo and the same pitch tone as the marketing site.
- **Super admin** (`/super-admin.html`) — live account count, total
  credits/actions used, a "+ New account" flow that provisions a Sales
  CRM and its first admin login in one step, a per-account table
  (team size, credits used vs. editable limit, last active), suspend/
  reactivate any account, and a global activity feed across every
  account. Super admins aren't capped at 3 team members per account —
  that limit is only for self-service admins.
- **Admin — Sales CRM module** (`/admin.html`, `type: 'sales'`) — lead
  pipeline (New / Contacted / Hot / Cold / Converted), automation
  buttons ("Read emails & find new leads", "Score leads", "Send
  follow-up" — each spends simulated credits, writes real rows to
  Postgres, and logs to the activity feed), a leads table, and team
  management capped at 3 users ("contact a super admin" past that).

  Super admins can open any account's admin view via "View →" in their
  table and trigger the same actions, or add teammates, on that
  account's behalf.

- **Leads — Kanban + List, manual entry** — the Leads panel has a
  Freshsales-style Kanban board (drag a card between columns to move
  its stage, each column shows deal count + total $ value) and a List
  toggle for a plain table. "+ Add lead" opens a form to add a lead by
  hand (name, company, stage, deal value, source) — no automation
  needed. Every automation-generated lead now also gets a randomized
  deal value so the board isn't all zeros. Both manual entry and
  drag-to-move are available to every CRM user, primary or not.
- **Roles, kept simple** — one Admin per account (the primary admin,
  automatically), everyone else added is a "User." Both show as a tag
  next to their name in Team. No manual role picking — it just mirrors
  who's primary, which is also what actually drives permissions (Team
  tab, Activity feed, which automations are available).
- **Editable leads** — click any Kanban card (or hit "Edit" in List view)
  to open a lead's details: name, company, stage, deal value, source,
  and last contacted are all editable and save back to Postgres. The
  same modal shows that lead's own activity history (added, moved
  between stages, edited) — separate from the account-wide feed.
- **Ina agent panel** — a persistent panel next to the leads/activity
  feed that narrates only what Ina (the automations) actually did, so
  it's a clean log of agent activity separate from human actions like
  adding leads or teammates.
- **Team tab, redesigned** — a clean table (avatar, name, username) with
  a "+ New user" button that opens the add-user form in a modal instead
  of sitting inline. Each row has a "View →" that opens that user's
  detail: their username, a "Reset password" field, stats (deals won,
  revenue they've brought in — attributed from leads they added that
  reached Converted, plus automations run), and their task list with
  "+ Task" / "🔔 Remind" right there.
- **Tasks & reminders** — in the Team tab, the primary admin (and super
  admins) can hit "+ Task" or "🔔 Remind" next to any teammate to assign
  them a task or send a check-in, with an optional due date. That
  teammate then sees it in a "My tasks" panel at the top of their Home
  view and can mark it done — which the primary admin sees update live
  under that teammate's row in Team, too.
- **Primary admin vs. teammates** — the first login created for an
  account (via "+ New account") is its **primary admin**. Only the
  primary admin (and super admins) can see the Team tab, see what each
  teammate has been doing (action count + last active, per person), and
  add or remove teammates. Everyone else added to that account gets a
  **plain CRM**: no Team tab, and only the "safe" automations for their
  module (e.g. "Read emails & find new leads" and "Send follow-up" —
  not "Score leads"). This is enforced on the server too, not just
  hidden in the UI, so a teammate can't call a restricted action
  directly. Every automation and every "user added" event is now
  attributed to the person who triggered it (or "Super admin (name)"
  when done via impersonation), and shows up next to the activity entry.

## Real Estate CRM module

A second full module, live and selectable from "+ New account" as
**Real Estate CRM**. It has its own tables (`re_leads`, `re_brokers`,
`re_inventory`, `re_accounting`) and its own sidebar tabs — Dashboard,
Leads, Brokers, Inventory, Accounting — all in the same KineSys-branded
dark shell as Sales. Every tab supports manual entry — a "+ Add" button
and a per-row/card "Edit" link open a modal to create or update leads,
brokers, inventory units, and accounting transactions (including
changing status, e.g. moving a lead from New to Site Visit or a
transaction to Received). Ina's automations can also move things along
on their own:

- **Scan leads inbox** — captures a new lead, auto-assigned to whichever active broker has the fewest active leads
- **Sync leads sheet** — advances a lead one stage forward (New → Contacted → Site Visit → Negotiation → Closed)
- **Match payment receipt** — marks the oldest pending transaction as Received
- **Rebalance broker leads** — shifts load from the busiest broker to the quietest
- **Check follow-up SLAs** — flags leads whose next follow-up date has passed

Team, tasks/reminders, and the Ina agent panel all work the same way
they do for Sales — those are shared across every module, not
Sales-specific.

### Seed the demo Real Estate CRM account

A ready-to-use account, pre-loaded with the exact dummy data from the
delivered `Real_Estate_CRM.xlsx` (7 leads, 5 brokers, 7 inventory
units, 5 transactions, 5 automation-log entries):

```
npm run seed:realestate
```

Safe to re-run — it skips creating the account/admin if it already
exists, and skips reloading the dummy data if it's already there.

Login: username `Inacio Fernandes`, password set in
`data/seed-realestate.js` (same one you gave me — treat that file as
sensitive, same as `data/seed.js`).

## Built for more than just Sales and Real Estate, when you're ready

The account/module model also supports a simple ERP "counters" shape
(running totals + action buttons, like Finance or Supply Chain &
Procurement, matching the homepage gallery) — it's defined in the
`MODULES` registry in `data/db.js` but nothing seeds it yet. Adding
a fully custom module (its own tables, its own tabs) follows the same
pattern the Real Estate CRM module used: new tables in `schema.sql`,
a `MODULES` entry with its automations, a branch in `getAccountDetail`,
and new view-sections in `admin.html`/`admin.js`.

## Notes / next steps

- Passwords are hashed with bcrypt; sessions are stored in Postgres too
  (`connect-pg-simple`), so logging in survives a server restart.
- Automations are simulated (random mock leads), not yet wired to the
  real EKB/Odin agent that powers Ina on the marketing site.
- `data/schema.sql` is the full table definition if you ever need to
  recreate the database elsewhere — `npm run seed` runs it
  automatically and is safe to re-run (it won't duplicate the super
  admin or drop existing columns).
