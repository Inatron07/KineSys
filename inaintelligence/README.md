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

The dashboard also has a light theme (`re-light`) and three chart
panels — lead pipeline by stage, lead source donut, and a 14-day lead
growth chart — computed client-side from the same data already on the
page (hand-drawn inline SVG, no chart library dependency).

Every lead, broker, and inventory unit now has its own detail page too
(click the name), mirroring the LeadSquared-style contact/lead layout
the team reviewed: a profile card with stats, and a real activity
timeline pulled from Postgres. Leads also get a notes box that logs
straight into that lead's timeline, plus an owner/broker dropdown that
reassigns them in place. Broker pages list every lead currently
assigned to them with a one-click "Remove", and an "+ Assign" picker
to add more. Inventory pages list any leads whose "property interest"
mentions that project, and now embed a Google Maps view (built from
latitude/longitude if set, otherwise the unit's location text — no API
key needed). A static side-by-side mockup of this layout (not wired to
the backend) lives in `public/re-preview/` if you want to compare.

Leads, brokers, and inventory units also carry a few extra profile
fields beyond the original spreadsheet columns — nationality (leads),
license number + joined date (brokers), and bedrooms/bathrooms/
possession date/amenities/description/lat-long (inventory) — editable
from the same Add/Edit modals and shown on each detail page.

The Ina agent log on the Real Estate dashboard is a floating widget
(bottom-right corner, like a chat bubble) rather than a fixed panel —
click it to expand the automation feed, click again or the ✕ to
collapse it. It only appears while the Real Estate dashboard is the
active view.

Team, tasks/reminders, and (on Sales) the Ina agent panel all work the
same way they do for Sales — those are shared across every module, not
Sales-specific.

### Monthly Reports

A sidebar tab (after Team, Real Estate accounts only) gives a manager
a single-screen scorecard — one row per broker with target vs. total
achieved, this calendar month's collections (from `re_accounting`,
matched by broker name), deals closed this month, new leads assigned
this month, current active/closed-deal counts, and a conversion rate.
Summary cards above the table roll all of that up account-wide, plus
call out the top performer by this month's collections. It's all
computed live from existing tables (`db.getREMonthlyReport`) — no new
schema needed.

### Broker lead counts are always real

A broker's "Active leads" and "Closed deals" numbers (on the Brokers list,
broker detail page, and Monthly Reports) are computed live from the actual
`re_leads` rows assigned to them — never from a stored counter that can
drift out of sync. `npm run seed:realestate` tops up each seeded broker
with enough generated leads (realistic names/sources/property interest/
dates spread over the last ~8 weeks) so their stated targets are backed
by real records; safe to re-run, it only inserts whatever shortfall
remains. On the broker detail page, the "Active leads" and "Closed deals"
stat boxes are clickable — they filter the "Assigned leads" list below to
just that bucket (click again, or "Show all", to reset).

### Search, filter, and multi-select on every table

Leads, Brokers, Inventory, Accounting, Team, and Monthly Reports each have
a toolbar above the table: a live search box (matches name/phone/email/
property/etc. as you type) plus dropdown filters relevant to that table
(status, broker, source, zone, type, payment mode, role...), and for the
tables with genuinely numeric/date data — Leads, Inventory, Accounting —
min/max range filters (budget, price, area, amount, date received/
transaction date). "Reset" clears everything back to the full list.
Leads, Brokers, Inventory, Accounting, and Team also get SharePoint-style
row selection: a checkbox per row plus a "select all" checkbox in the
header that only selects whatever's currently visible (i.e. respects
active filters), with a "N selected / Clear selection" bar. All of this
runs client-side against data already on the page — no extra API calls,
and everything (`admin.js`'s `tt*` helpers) is one small reusable engine
rather than six one-off implementations.

### Bulk lead import from Excel

The Leads tab has an "Upload Excel" button next to "+ Add lead" that
accepts a `.xlsx`/`.xls`/`.csv` file (parsed server-side with the
`xlsx` package) and bulk-creates leads, matching a "Broker" column
against existing brokers by name (case-insensitive; unmatched or blank
broker names are left unassigned). Header matching is loose — "Name",
"Phone", "Property Interest", "Next Follow-up", etc. all match with
different casing/spacing. A "Sample file" download link next to it
serves `public/downloads/leads-upload-sample.xlsx`, a ready-made
15-lead example (matching the seeded demo brokers) you can download
and re-upload to demo the whole round trip.

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
