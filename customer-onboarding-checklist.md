# Real Estate CRM — Customer Onboarding Checklist

Working checklist for standing up the CRM for the first real customer (25 brokers, 20–25 WhatsApp numbers). Each section notes what's already built, what's new work, and what has to come from the customer.

---

## 1. Their personal domain

- [ ] Get their domain name from them (e.g. `theircompany.com`)
- [ ] Confirm who controls DNS for it (registrar/provider — same as the GoDaddy/kinesys.net process we just ran)
- [ ] Add it as a custom domain on the Render service, get the A/CNAME records, have them (or us, with access) point DNS at it
- [ ] Wait for verification + SSL cert issuance, confirm it loads

This is the same process we just did for kinesys.net — proven to work, just repeat it for their domain.

## 2. CRM branded to their logo/colours

**Open decision before building:** right now all branding (colors, fonts, logo) is one hardcoded stylesheet shared by every account. Two ways to handle a second brand:

- **Option A — one shared app, branding becomes account-scoped** (recommended): store each account's logo URL + a few color tokens in the DB, load them dynamically based on who's logged in. More engineering up front, but consistent with the multi-tenant WhatsApp work we just did, and scales cleanly to a 3rd, 4th customer later.
- **Option B — separate deployment per customer**: fork the app, hardcode their branding, deploy as its own Render service. Faster for one customer, but doubles ops/maintenance work per customer going forward (two codebases to patch, two databases, etc).

- [ ] Decide A vs B
- [ ] Get their logo file (SVG preferred) + brand colors from them
- [ ] Apply branding

## 3. New sidebar tabs — Agent personality + Knowledge base

- **Agent personality**: partially built already — the WhatsApp setup panel now has agent name / business name / business context fields. Worth promoting into its own dedicated "Agent" tab with a nicer editor rather than living inside WhatsApp setup, if this is going to be a regular thing customers tune.
- **Knowledge base**: doesn't exist yet. Needs scoping:
  - [ ] Decide MVP: a single free-text block fed into the agent's system prompt (fast to build, fine for smaller amounts of info) vs. a real document-upload + retrieval system (needed if they have a lot of material — property brochures, FAQs, policies)
  - [ ] Build storage (new table) + editor UI + wire into `whatsappAgent.js`'s system prompt

- [ ] Build "Agent" tab (personality + knowledge base together)

## 4. Excel lead upload with phone numbers

**Already built** — the Leads Excel importer (with a downloadable sample template) already supports phone numbers as a column. Just needs:

- [ ] Get a sample of their actual lead spreadsheet to confirm our column format matches theirs (or adjust the importer's expected columns if not)

## 5. Admin + 25 broker user setup

**Already built**: team management with Admin/User roles, per-broker lead ownership, sales stats, task assignment. What's needed:

- [ ] Get their team list: name, phone, email/username per broker, and who's Admin
- [ ] Decide access model — do all 25 brokers see all leads, or only their assigned ones? (current system supports both; needs a decision)
- [ ] Bulk-create the 25 accounts (faster than one-by-one — can script this once we have the list)

## 6. WhatsApp: multiple numbers, template switching

**Just built**: the per-account WhatsApp config (phone number ID, access token, template name, agent persona) — this is what makes "which number/template" configurable per account at all.

**Still needed for 20–25 numbers specifically**: right now the system assumes one WhatsApp number per *account*. With 20–25 numbers under one customer, decide:
- [ ] One number per broker (25 separate `re_whatsapp_config`-style rows, broker-scoped not account-scoped) — bigger schema change, most realistic model if each broker WhatsApps from their own number
- [ ] Or a smaller pool of shared numbers rotated across brokers — simpler, less realistic for how real estate WhatsApp outreach usually works

- [ ] Build a settings screen to switch which number/template sends for a given broker/conversation
- [ ] All 20–25 numbers need their own Meta verification + template approval (see #8)

## 7. Claude API token cost

Rough estimate, pin down once #9's usage cap is decided: at ~20k tokens/conversation (blended input/output, based on the earlier estimate we walked through) and Sonnet 5 pricing (~$3/$15 per 1M tokens from Sept 1, 2026), each conversation costs roughly **$0.10–0.15**. At a cap of 100 chats/user/month × 25 users = 2,500 conversations/month, that's roughly **$250–375/month** in Claude API spend for this customer. Actual cost depends on real conversation length — worth tracking for the first few weeks and adjusting.

- [ ] Set up a dedicated Anthropic API key for this customer (don't share the demo account's key — makes cost tracking and rate limits cleaner)
- [ ] Monitor actual usage in week 1–2, compare to this estimate

## 8. Meta app + WhatsApp API, bulk send to brokers

- [ ] Customer needs their own Meta Business app + WABA (or we help them set one up)
- [ ] Each of the 20–25 numbers needs Meta Business verification + template approval (learned this week: templates must be **Utility** category if transactional, or they hit the same throttling we just debugged)
- **New feature, not built yet**: bulk-sending a template to *brokers* (internal team) rather than leads. The current bulk-send only targets the leads table — brokers already have a `phone` field on file, so this is a straightforward extension of the existing bulk-send code, not a rebuild.
  - [ ] Build "notify all brokers" bulk template send

## 9. Usage cap — 100 chats/month/user

**Not built yet.** Current system only tracks a generic account-wide credit counter (`credits_used`/`credit_limit`), not per-user WhatsApp/Claude usage specifically. Needed:

- [ ] New per-user monthly conversation counter (reset monthly)
- [ ] Hard stop or warning once a user/broker hits their cap — decide behavior: agent stops auto-replying and flags for human handoff, vs. just an alert to the admin
- [ ] Surface usage-vs-cap somewhere visible (Team tab per-user, or a dashboard widget)

This is the mechanism that makes #7's cost estimate actually hold in practice.

## 10. Super admin: revoke licenses, manage account details

- **Already built** at the *account* level: suspend/activate a whole account, set its credit limit (super admin overview).
- **Not built**: revoking access for one specific broker out of the 25 without touching the other 24 or the account as a whole. Needed:
  - [ ] Add an active/inactive toggle per team member (not just per account)
  - [ ] Surface it in the Team tab and/or your super admin overview
  - [ ] Decide what "revoked" means precisely — login blocked but data kept? Removed from broker-assignment rotation? Both?

## 11. Broker login method — phone+password vs WhatsApp OTP

**Open decision, discuss later.** Two ways for the 25 brokers to log in:

- **Phone number + password** (current model, same as existing users) — simplest to build, nothing new needed, but brokers have to remember/manage a password.
- **WhatsApp-delivered one-time code** ("unlock" via a code sent to their number) — no password to manage, feels native given they're already living in WhatsApp for this tool, but is new build work: a code-generation + expiry system, a send-code step using the WhatsApp send infra we already have, and a verify-code login flow replacing (or sitting alongside) the password form.

- [ ] Decide phone+password vs WhatsApp OTP vs offer both
- [ ] If OTP: decide code expiry time, retry/resend limits, fallback if WhatsApp delivery fails

---

## Infrastructure — the two "(do we need?)" questions

**Render — do we need a paid plan?**
Yes, at minimum the web service itself needs to come off Render's **Free** instance type (confirmed that's what it's currently running on). Free instances spin down after 15 minutes idle — for a live WhatsApp webhook that Meta expects to respond to promptly and retries aggressively against, cold-starts risk missed or delayed messages. Recommend upgrading to at least a **Starter** instance (~$7/mo) for the web service. Whether the account-wide **Pro** plan is needed depends on things we don't know yet — team seat limits, support SLA — worth checking Render's plan page once we know how many of your people need dashboard/deploy access.

**Database — do we need more than 0.5GB?**
Very likely yes, before too long. 0.5GB is Neon's free-tier ceiling. With 25 brokers, 20–25 WhatsApp numbers, and real message/lead/activity-log volume accumulating monthly, a customer at this scale will plausibly outgrow 0.5GB within months (Neon's paid tiers or Render's own Postgres are the options). Recommend upgrading proactively rather than finding out mid-production when writes start failing. Also worth deciding a retention policy for old WhatsApp messages/activity logs to control long-term growth either way.
