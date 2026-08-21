'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env — copy .env.example to .env and paste your Neon connection string in.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function id(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

function hash(pw) {
  return bcrypt.hashSync(pw, 8);
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function incrementCounter(client, accountId, key, amount) {
  await client.query(
    `UPDATE accounts SET counters = jsonb_set(
       counters, ARRAY[$1], to_jsonb(COALESCE((counters->>$1)::int, 0) + $2)
     ) WHERE id=$3`,
    [key, amount, accountId]
  );
}

// ---- module registry ----
// Each account "type" maps to a module: 'pipeline' (CRM-style — Sales) or
// 'counters' (ERP-style — Supply Chain, and future departments). Adding a
// new department later is mostly adding an entry here plus seed data.
const MODULES = {
  sales: {
    kind: 'pipeline',
    actions: {
      find_leads: {
        label: 'Read emails & find new leads',
        icon: '📧',
        plain: true,
        async run(client, accountId) {
          const count = rand(1, 4);
          const names = ['Ankit Verma', 'Sara Iqbal', 'Marco Reyes', 'Fatima Noor', 'Declan Shaw', 'Priyanka Rao', 'Tom Halvorsen', 'Wei Chen'];
          const companies = ['Zenith Retail', 'Nova Freight', 'BluePeak Logistics', 'Harbor & Co', 'Crestline Manufacturing', 'Solstice Insurance'];
          const added = [];
          for (let i = 0; i < count; i++) {
            const name = names[rand(0, names.length - 1)];
            const company = companies[rand(0, companies.length - 1)];
            const value = rand(5, 60) * 500;
            await client.query(
              `INSERT INTO leads (id, account_id, name, company, status, source, value, last_contacted)
               VALUES ($1,$2,$3,$4,'New','Ina — inbox scan', $5, NULL)`,
              [id('lead'), accountId, name, company, value]
            );
            added.push(name);
          }
          return { credits: rand(80, 220), summary: `Ina scanned the inbox and found ${count} new lead${count === 1 ? '' : 's'}: ${added.join(', ')}.` };
        }
      },
      score_leads: {
        label: 'Score leads',
        icon: '🎯',
        async run(client, accountId) {
          const { rows } = await client.query(
            `SELECT id FROM leads WHERE account_id=$1 AND status IN ('New','Contacted') ORDER BY created_at DESC LIMIT 3`,
            [accountId]
          );
          let hot = 0, cold = 0;
          for (const row of rows) {
            const nextStatus = Math.random() > 0.45 ? 'Hot' : 'Cold';
            if (nextStatus === 'Hot') hot++; else cold++;
            await client.query(`UPDATE leads SET status=$1 WHERE id=$2`, [nextStatus, row.id]);
          }
          return {
            credits: rand(40, 120),
            summary: rows.length
              ? `Ina scored ${rows.length} lead${rows.length === 1 ? '' : 's'} — ${hot} marked hot, ${cold} marked cold.`
              : 'Ina scored the pipeline — no unscored leads left to review.'
          };
        }
      },
      send_followup: {
        label: 'Send follow-up',
        icon: '✉️',
        plain: true,
        async run(client, accountId) {
          const { rows } = await client.query(
            `SELECT id, status FROM leads WHERE account_id=$1 AND status IN ('Contacted','Hot') ORDER BY created_at DESC LIMIT 3`,
            [accountId]
          );
          let converted = 0;
          for (const row of rows) {
            if (row.status === 'Hot' && Math.random() > 0.6) {
              await client.query(`UPDATE leads SET status='Converted', last_contacted='Today' WHERE id=$1`, [row.id]);
              converted++;
            } else {
              await client.query(`UPDATE leads SET last_contacted='Today' WHERE id=$1`, [row.id]);
            }
          }
          return {
            credits: rand(20, 60),
            summary: rows.length
              ? `Ina sent follow-ups to ${rows.length} lead${rows.length === 1 ? '' : 's'}${converted ? `, ${converted} converted` : ''}.`
              : 'No contacted or hot leads needed a follow-up right now.'
          };
        }
      }
    }
  },

  supply_chain: {
    kind: 'counters',
    actions: {
      approve_po: {
        label: 'Approve PO',
        icon: '✅',
        plain: true,
        async run(client, accountId) {
          const n = rand(1, 4);
          await incrementCounter(client, accountId, 'pr_to_po', n);
          return { credits: rand(30, 90), summary: `Ina converted ${n} purchase requisition${n === 1 ? '' : 's'} into approved PO${n === 1 ? '' : 's'}.` };
        }
      },
      add_vendor: {
        label: '+ Add Vendor',
        icon: '🚚',
        async run(client, accountId) {
          await incrementCounter(client, accountId, 'vendors_onboarded', 1);
          return { credits: rand(50, 150), summary: 'Ina ran compliance checks and onboarded a new vendor.' };
        }
      },
      track_shipments: {
        label: 'Track Shipments',
        icon: '📦',
        plain: true,
        async run(client, accountId) {
          const n = rand(1, 5);
          await incrementCounter(client, accountId, 'shipments_tracked', n);
          return { credits: rand(10, 40), summary: `Ina pulled updated tracking status for ${n} shipment${n === 1 ? '' : 's'}.` };
        }
      }
    }
  },

  real_estate: {
    kind: 'real_estate',
    actions: {
      scan_inbox: {
        label: 'Scan leads inbox',
        icon: '📧',
        plain: true,
        async run(client, accountId) {
          const names = ['Rohit Bansal', 'Anjali Kapoor', 'Sameer Joshi', 'Pooja Nambiar', 'Vivek Chandra', 'Fatima Ansari', 'Nikhil Rana'];
          const projects = ['Skyline Heights, Andheri', 'Palm Villas, Whitefield', 'Oceanview Towers, Powai', 'Green Meadows Plot, Sohna', 'Metro Business Park, BKC', 'Sunrise Residency, Thane'];
          const sources = ['99acres', 'MagicBricks', 'Facebook Ads', 'Referral', 'Website Form', 'Walk-in'];
          const name = names[rand(0, names.length - 1)];
          const project = projects[rand(0, projects.length - 1)];
          const source = sources[rand(0, sources.length - 1)];
          const budget = rand(40, 320) * 100000;

          const { rows: brokers } = await client.query(
            `SELECT id, name FROM re_brokers WHERE account_id=$1 AND status='Active' ORDER BY active_leads ASC LIMIT 1`,
            [accountId]
          );
          const broker = brokers[0] || null;

          const leadId = id('re_lead');
          await client.query(
            `INSERT INTO re_leads (id, account_id, name, source, property_interest, budget, status, broker_id, date_received, next_followup, remarks, assigned_at)
             VALUES ($1,$2,$3,$4,$5,$6,'New',$7, CURRENT_DATE, CURRENT_DATE + 3, 'Auto-captured from portal', $8)`,
            [leadId, accountId, name, source, project, budget, broker ? broker.id : null, broker ? new Date() : null]
          );
          if (broker) {
            await client.query('UPDATE re_brokers SET active_leads = active_leads + 1 WHERE id=$1', [broker.id]);
          }
          return {
            credits: rand(80, 220),
            summary: broker
              ? `Ina scanned the leads inbox and captured ${name} (${source}), auto-assigned to ${broker.name}.`
              : `Ina scanned the leads inbox and captured ${name} (${source}) — no active broker available to assign.`
          };
        }
      },
      sync_sheet: {
        label: 'Sync leads sheet',
        icon: '🔄',
        async run(client, accountId) {
          const STAGES = ['New', 'Contacted', 'Site Visit', 'Negotiation', 'Closed'];
          const { rows } = await client.query(
            `SELECT id, name, status FROM re_leads WHERE account_id=$1 AND status <> 'Closed' AND status <> 'Lost' ORDER BY created_at DESC LIMIT 5`,
            [accountId]
          );
          if (!rows.length) return { credits: rand(10, 30), summary: 'Ina synced the leads sheet — nothing new to move forward.' };
          const row = rows[rand(0, rows.length - 1)];
          const idx = STAGES.indexOf(row.status);
          const next = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : row.status;
          await client.query('UPDATE re_leads SET status=$1, last_followup=CURRENT_DATE WHERE id=$2', [next, row.id]);
          return { credits: rand(30, 90), summary: `Ina synced the leads sheet — ${row.name} moved from ${row.status} to ${next}.` };
        }
      },
      match_payment: {
        label: 'Match payment receipt',
        icon: '🧾',
        plain: true,
        async run(client, accountId) {
          const { rows } = await client.query(
            `SELECT id, client_name, amount FROM re_accounting WHERE account_id=$1 AND status='Pending' ORDER BY created_at DESC LIMIT 1`,
            [accountId]
          );
          if (rows.length) {
            await client.query(`UPDATE re_accounting SET status='Received' WHERE id=$1`, [rows[0].id]);
            return { credits: rand(20, 60), summary: `Ina matched a payment receipt to ${rows[0].client_name}'s transaction — marked Received.` };
          }
          return { credits: rand(10, 20), summary: 'Ina checked for new payment receipts — nothing pending to match right now.' };
        }
      },
      rebalance_leads: {
        label: 'Rebalance broker leads',
        icon: '⚖️',
        async run(client, accountId) {
          const { rows } = await client.query(
            `SELECT id, name, active_leads FROM re_brokers WHERE account_id=$1 AND status='Active' ORDER BY active_leads DESC`,
            [accountId]
          );
          if (rows.length < 2) return { credits: rand(10, 20), summary: 'Ina checked broker load — not enough active brokers to rebalance.' };
          const busiest = rows[0];
          const quietest = rows[rows.length - 1];
          if (busiest.active_leads - quietest.active_leads < 3) {
            return { credits: rand(10, 20), summary: 'Ina checked broker load — leads are already balanced across the team.' };
          }
          await client.query('UPDATE re_brokers SET active_leads = active_leads - 1 WHERE id=$1', [busiest.id]);
          await client.query('UPDATE re_brokers SET active_leads = active_leads + 1 WHERE id=$1', [quietest.id]);
          return { credits: rand(30, 70), summary: `Ina rebalanced leads — reassigned 1 lead from ${busiest.name} to ${quietest.name}.` };
        }
      },
      followup_watcher: {
        label: 'Check follow-up SLAs',
        icon: '⏰',
        plain: true,
        async run(client, accountId) {
          const { rows } = await client.query(
            `SELECT name FROM re_leads WHERE account_id=$1 AND status NOT IN ('Closed','Lost') AND next_followup IS NOT NULL AND next_followup < CURRENT_DATE LIMIT 5`,
            [accountId]
          );
          if (!rows.length) return { credits: rand(10, 20), summary: 'Ina checked follow-up SLAs — everyone is on schedule.' };
          const names = rows.map((r) => r.name).join(', ');
          return { credits: rand(20, 50), summary: `Ina flagged overdue follow-ups for: ${names}.` };
        }
      }
    }
  }
};

// ---------- auth ----------
async function findUserByUsername(username) {
  const superAdmin = await pool.query('SELECT * FROM super_admins WHERE username=$1', [username]);
  if (superAdmin.rows[0]) {
    const row = superAdmin.rows[0];
    return { role: 'super_admin', user: { id: row.id, username: row.username, name: row.name, passwordHash: row.password_hash }, account: null };
  }

  const member = await pool.query(
    `SELECT tm.*, a.id AS acc_id, a.name AS acc_name FROM team_members tm
     JOIN accounts a ON a.id = tm.account_id WHERE tm.username=$1`,
    [username]
  );
  if (member.rows[0]) {
    const row = member.rows[0];
    return {
      role: 'admin',
      user: { id: row.id, username: row.username, name: row.name, passwordHash: row.password_hash, isPrimary: row.is_primary },
      account: { id: row.acc_id, name: row.acc_name }
    };
  }
  return null;
}

function verifyPassword(password, passwordHash) {
  return bcrypt.compareSync(password || '', passwordHash);
}

// ---------- super admin overview ----------
async function getSuperAdminOverview() {
  const { rows: accounts } = await pool.query(`
    SELECT a.*,
      (SELECT count(*) FROM team_members WHERE account_id = a.id) AS team_size,
      (SELECT max(at) FROM activity WHERE account_id = a.id) AS last_active
    FROM accounts a ORDER BY a.name
  `);

  const totals = accounts.reduce((acc, a) => {
    acc.creditsUsed += a.credits_used;
    acc.actionsTriggered += a.actions_triggered;
    acc.teamMembers += Number(a.team_size);
    return acc;
  }, { creditsUsed: 0, actionsTriggered: 0, teamMembers: 0 });

  const { rows: globalActivity } = await pool.query(`
    SELECT act.id, act.text, act.at, act.actor_name, a.name AS account_name, a.id AS account_id
    FROM activity act JOIN accounts a ON a.id = act.account_id
    ORDER BY act.at DESC LIMIT 12
  `);

  return {
    liveAccounts: accounts.filter((a) => a.status === 'active').length,
    totalAccounts: accounts.length,
    totals,
    accounts: accounts.map((a) => ({
      id: a.id, name: a.name, type: a.type, typeLabel: (MODULE_PRESETS[a.type] || {}).label || a.type,
      moduleKind: a.module_kind, pipelineLabel: a.pipeline_label, statuses: a.statuses,
      status: a.status, creditLimit: a.credit_limit, creditsUsed: a.credits_used,
      actionsTriggered: a.actions_triggered, teamSize: Number(a.team_size),
      lastActive: a.last_active ? new Date(a.last_active).getTime() : null,
      licenseNumber: a.license_number, licenseTermMonths: a.license_term_months,
      startsAt: a.starts_at ? new Date(a.starts_at).getTime() : null,
      expiresAt: a.expires_at ? new Date(a.expires_at).getTime() : null
    })),
    globalActivity: globalActivity.map((r) => ({
      id: r.id, text: r.text, actor: r.actor_name, at: new Date(r.at).getTime(), accountName: r.account_name, accountId: r.account_id
    }))
  };
}

async function toggleAccountStatus(accountId) {
  const { rows } = await pool.query('SELECT status FROM accounts WHERE id=$1', [accountId]);
  if (!rows[0]) return null;
  const next = rows[0].status === 'active' ? 'suspended' : 'active';
  await pool.query('UPDATE accounts SET status=$1 WHERE id=$2', [next, accountId]);
  return next;
}

async function setCreditLimit(accountId, limit) {
  const { rows } = await pool.query('UPDATE accounts SET credit_limit=$1 WHERE id=$2 RETURNING credit_limit', [limit, accountId]);
  return rows[0] ? rows[0].credit_limit : null;
}

// ---------- account detail ----------
async function findAccount(accountId) {
  const { rows } = await pool.query('SELECT * FROM accounts WHERE id=$1', [accountId]);
  return rows[0] || null;
}

async function getAccountDetail(accountId) {
  const account = await findAccount(accountId);
  if (!account) return null;

  const module = MODULES[account.type] || MODULES.sales;
  const { rows: team } = await pool.query('SELECT * FROM team_members WHERE account_id=$1 ORDER BY is_primary DESC, name', [accountId]);
  const { rows: activity } = await pool.query('SELECT * FROM activity WHERE account_id=$1 ORDER BY at DESC LIMIT 30', [accountId]);
  const { rows: tasks } = await pool.query('SELECT * FROM tasks WHERE account_id=$1 ORDER BY status ASC, created_at DESC', [accountId]);
  const { rows: memberStats } = await pool.query(
    `SELECT actor_name, count(*) AS cnt, max(at) AS last_at FROM activity
     WHERE account_id=$1 AND actor_name IS NOT NULL GROUP BY actor_name`,
    [accountId]
  );
  const statsByName = {};
  memberStats.forEach((r) => { statsByName[r.actor_name] = { count: Number(r.cnt), lastActive: new Date(r.last_at).getTime() }; });

  const { rows: salesStats } = await pool.query(
    `SELECT owner_id,
       count(*) FILTER (WHERE status='Converted') AS deals_won,
       coalesce(sum(value) FILTER (WHERE status='Converted'), 0) AS revenue,
       count(*) AS leads_owned
     FROM leads WHERE account_id=$1 AND owner_id IS NOT NULL GROUP BY owner_id`,
    [accountId]
  );
  const salesByOwner = {};
  salesStats.forEach((r) => { salesByOwner[r.owner_id] = { dealsWon: Number(r.deals_won), revenue: Number(r.revenue), leadsOwned: Number(r.leads_owned) }; });

  const base = {
    id: account.id,
    name: account.name,
    type: account.type,
    typeLabel: (MODULE_PRESETS[account.type] || {}).label || account.type,
    status: account.status,
    moduleKind: module.kind,
    creditLimit: account.credit_limit,
    creditsUsed: account.credits_used,
    actionsTriggered: account.actions_triggered,
    licenseNumber: account.license_number,
    licenseTermMonths: account.license_term_months,
    startsAt: account.starts_at ? new Date(account.starts_at).getTime() : null,
    expiresAt: account.expires_at ? new Date(account.expires_at).getTime() : null,
    team: team.map((m) => ({
      id: m.id, name: m.name, username: m.username, isPrimary: m.is_primary, role: m.role,
      actionsCount: (statsByName[m.name] || {}).count || 0,
      lastActive: (statsByName[m.name] || {}).lastActive || null,
      dealsWon: (salesByOwner[m.id] || {}).dealsWon || 0,
      revenue: (salesByOwner[m.id] || {}).revenue || 0,
      leadsOwned: (salesByOwner[m.id] || {}).leadsOwned || 0
    })),
    activity: activity.map((a) => ({ id: a.id, text: a.text, actor: a.actor_name, at: new Date(a.at).getTime() })),
    actionsAvailable: Object.keys(module.actions).map((key) => ({ key, label: module.actions[key].label, icon: module.actions[key].icon, plain: !!module.actions[key].plain })),
    tasks: tasks.map((t) => ({
      id: t.id, assigneeId: t.assignee_id, assigneeName: t.assignee_name, createdBy: t.created_by,
      kind: t.kind, title: t.title, status: t.status,
      dueAt: t.due_at ? new Date(t.due_at).getTime() : null, createdAt: new Date(t.created_at).getTime()
    }))
  };

  if (module.kind === 'pipeline') {
    const { rows: leads } = await pool.query('SELECT * FROM leads WHERE account_id=$1 ORDER BY created_at DESC LIMIT 200', [accountId]);
    const { rows: pipelineRows } = await pool.query('SELECT status, count(*), coalesce(sum(value),0) AS total_value FROM leads WHERE account_id=$1 GROUP BY status', [accountId]);
    const pipeline = {};
    const pipelineValue = {};
    account.statuses.forEach((s) => { pipeline[s] = 0; pipelineValue[s] = 0; });
    pipelineRows.forEach((r) => { pipeline[r.status] = Number(r.count); pipelineValue[r.status] = Number(r.total_value); });
    return Object.assign(base, {
      pipelineLabel: account.pipeline_label,
      statuses: account.statuses,
      pipeline,
      pipelineValue,
      leads: leads.map((l) => ({
        id: l.id, name: l.name, company: l.company, status: l.status, source: l.source, value: l.value,
        lastContacted: l.last_contacted, createdAt: new Date(l.created_at).getTime()
      }))
    });
  }

  if (module.kind === 'real_estate') {
    // Speed-to-lead SLA: any lead still sitting untouched ("New") 5+ minutes
    // after being assigned gets auto-reassigned to whichever active broker
    // currently has the lightest active load. Runs inline on every read of
    // this account so the effect is visible immediately without a cron job.
    await enforceSpeedToLeadSLA(accountId);

    const { rows: brokers } = await pool.query('SELECT * FROM re_brokers WHERE account_id=$1 ORDER BY revenue_achieved DESC', [accountId]);
    const { rows: leads } = await pool.query(
      `SELECT l.*, b.name AS broker_name FROM re_leads l LEFT JOIN re_brokers b ON b.id = l.broker_id
       WHERE l.account_id=$1 ORDER BY l.created_at DESC LIMIT 200`,
      [accountId]
    );
    const { rows: inventory } = await pool.query('SELECT * FROM re_inventory WHERE account_id=$1 ORDER BY created_at DESC', [accountId]);
    const { rows: accounting } = await pool.query('SELECT * FROM re_accounting WHERE account_id=$1 ORDER BY txn_date DESC NULLS LAST, created_at DESC', [accountId]);
    const { rows: siteVisits } = await pool.query(
      `SELECT v.*, l.name AS lead_name, b.name AS broker_name, i.project_name, i.unit_no
       FROM re_site_visits v
       LEFT JOIN re_leads l ON l.id = v.lead_id
       LEFT JOIN re_brokers b ON b.id = v.broker_id
       LEFT JOIN re_inventory i ON i.id = v.inventory_id
       WHERE v.account_id=$1 ORDER BY v.scheduled_at ASC NULLS LAST, v.created_at DESC LIMIT 300`,
      [accountId]
    );
    // Active/closed lead counts per broker are always derived live from the
    // actual re_leads rows (not the static re_brokers.active_leads/closed_deals
    // columns) so what a broker's stat boxes show always matches what's really
    // assigned to them on the Leads tab — no separate counter to drift out of sync.
    const { rows: leadCountRows } = await pool.query(
      `SELECT broker_id,
         count(*) FILTER (WHERE status NOT IN ('Closed','Lost')) AS active_count,
         count(*) FILTER (WHERE status = 'Closed') AS closed_count
       FROM re_leads WHERE account_id=$1 AND broker_id IS NOT NULL GROUP BY broker_id`,
      [accountId]
    );
    const leadCountsByBroker = {};
    leadCountRows.forEach((r) => { leadCountsByBroker[r.broker_id] = { active: Number(r.active_count) || 0, closed: Number(r.closed_count) || 0 }; });
    const { rows: dashRows } = await pool.query(
      `SELECT
         (SELECT count(*) FROM re_leads WHERE account_id=$1 AND date_received = CURRENT_DATE) AS new_leads_today,
         (SELECT count(*) FROM re_leads WHERE account_id=$1 AND broker_id IS NULL) AS unassigned,
         (SELECT count(*) FROM re_site_visits WHERE account_id=$1 AND status='Scheduled') AS site_visits,
         (SELECT count(*) FROM re_brokers WHERE account_id=$1 AND status='Active') AS active_brokers`,
      [accountId]
    );
    const d = dashRows[0] || {};

    return Object.assign(base, {
      dashboard: {
        newLeadsToday: Number(d.new_leads_today) || 0,
        unassigned: Number(d.unassigned) || 0,
        siteVisits: Number(d.site_visits) || 0,
        activeBrokers: Number(d.active_brokers) || 0
      },
      leads: leads.map((l) => ({
        id: l.id, name: l.name, phone: l.phone, email: l.email, source: l.source,
        propertyInterest: l.property_interest, budget: Number(l.budget) || 0, status: l.status,
        brokerId: l.broker_id, broker: l.broker_name, nationality: l.nationality,
        dateReceived: l.date_received, lastFollowup: l.last_followup, nextFollowup: l.next_followup,
        remarks: l.remarks, createdAt: new Date(l.created_at).getTime()
      })),
      brokers: brokers.map((b) => {
        const counts = leadCountsByBroker[b.id] || { active: 0, closed: 0 };
        return {
          id: b.id, name: b.name, phone: b.phone, email: b.email, zone: b.zone,
          activeLeads: counts.active, closedDeals: counts.closed,
          conversionPct: Number(b.conversion_pct) || 0, commissionPct: b.commission_pct,
          salesTarget: Number(b.sales_target) || 0, revenueAchieved: Number(b.revenue_achieved) || 0,
          status: b.status, achievedPct: b.sales_target > 0 ? Number(b.revenue_achieved) / Number(b.sales_target) : 0,
          licenseNo: b.license_no, joinedAt: b.joined_at
        };
      }),
      inventory: inventory.map((i) => ({
        id: i.id, projectName: i.project_name, unitNo: i.unit_no, type: i.type,
        areaSqft: i.area_sqft, price: Number(i.price) || 0, status: i.status, location: i.location,
        bedrooms: i.bedrooms, bathrooms: i.bathrooms, possessionDate: i.possession_date,
        amenities: i.amenities, description: i.description,
        latitude: i.latitude !== null && i.latitude !== undefined ? Number(i.latitude) : null,
        longitude: i.longitude !== null && i.longitude !== undefined ? Number(i.longitude) : null,
        images: i.images || []
      })),
      accounting: accounting.map((t) => ({
        id: t.id, date: t.txn_date, clientName: t.client_name, property: t.property,
        amount: Number(t.amount) || 0, type: t.type, brokerName: t.broker_name,
        paymentMode: t.payment_mode, status: t.status
      })),
      siteVisits: siteVisits.map((v) => ({
        id: v.id, leadId: v.lead_id, leadName: v.lead_name, brokerId: v.broker_id, brokerName: v.broker_name,
        inventoryId: v.inventory_id, propertyLabel: v.project_name ? (v.project_name + (v.unit_no ? ' ' + v.unit_no : '')) : null,
        scheduledAt: v.scheduled_at ? new Date(v.scheduled_at).getTime() : null,
        status: v.status, notes: v.notes, createdAt: new Date(v.created_at).getTime()
      }))
    });
  }

  return Object.assign(base, {
    metrics: account.metrics,
    counters: account.counters
  });
}

async function runAccountAction(accountId, actionKey, actorName) {
  const account = await findAccount(accountId);
  if (!account) return { error: 'Account not found.' };
  const module = MODULES[account.type] || MODULES.sales;
  const action = module.actions[actionKey];
  if (!action) return { error: 'Unknown action.' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action.run(client, accountId);
    await client.query(
      'UPDATE accounts SET credits_used = credits_used + $1, actions_triggered = actions_triggered + 1 WHERE id=$2',
      [result.credits, accountId]
    );
    await client.query(
      'INSERT INTO activity (id, account_id, text, actor_name) VALUES ($1,$2,$3,$4)',
      [id('act'), accountId, result.summary, actorName || null]
    );
    await client.query('COMMIT');
    return { credits: result.credits, summary: result.summary };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Only one role distinction matters: the account's primary admin is
// "Admin", every other teammate is a plain "User" — no manual picking.
const ROLE_OPTIONS = ['Admin', 'User'];

async function addTeamMember(accountId, { name, username, password }, opts) {
  opts = opts || {};
  const cap = opts.bypassCap ? Infinity : 3;
  const { rows } = await pool.query('SELECT count(*) FROM team_members WHERE account_id=$1', [accountId]);
  if (Number(rows[0].count) >= cap) {
    return { error: 'This account already has 3 users. Contact a super admin to add more.' };
  }
  const existing = await findUserByUsername(username);
  if (existing) return { error: 'That username is already in use.' };

  const memberId = id('user');
  const isPrimary = Number(rows[0].count) === 0; // first user on the account becomes its one admin
  const memberRole = isPrimary ? 'Admin' : 'User';
  await pool.query(
    'INSERT INTO team_members (id, account_id, name, username, password_hash, is_primary, role) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [memberId, accountId, name, username, hash(password), isPrimary, memberRole]
  );
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name) VALUES ($1,$2,$3,$4)',
    [id('act'), accountId, `${name} was added to the team.`, opts.addedByName || null]
  );
  return { ok: true, isPrimary };
}

async function resetPassword(accountId, memberId, newPassword, actorName) {
  if (!newPassword || newPassword.length < 6) return { error: 'New password must be at least 6 characters.' };
  const { rows } = await pool.query('SELECT * FROM team_members WHERE id=$1 AND account_id=$2', [memberId, accountId]);
  if (!rows[0]) return { error: 'User not found on this account.' };
  await pool.query('UPDATE team_members SET password_hash=$1 WHERE id=$2', [hash(newPassword), memberId]);
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name) VALUES ($1,$2,$3,$4)',
    [id('act'), accountId, `${actorName || 'Admin'} reset the password for ${rows[0].name}.`, actorName || null]
  );
  return { ok: true };
}

// ---------- manual lead entry & pipeline moves ----------
async function addLead(accountId, { name, company, status, source, value, lastContacted, ownerId }, actorName) {
  const account = await findAccount(accountId);
  if (!account) return { error: 'Account not found.' };
  if (!name || !company) return { error: 'Lead name and company are required.' };
  const validStatus = account.statuses.includes(status) ? status : account.statuses[0];

  const leadId = id('lead');
  await pool.query(
    `INSERT INTO leads (id, account_id, name, company, status, source, value, owner_id, last_contacted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [leadId, accountId, name, company, validStatus, source || 'Manual entry', Number(value) || 0, ownerId || null, lastContacted || null]
  );
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, lead_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `${actorName || 'Someone'} added a new lead: ${name} (${company}).`, actorName || null, leadId]
  );
  return { ok: true, id: leadId };
}

async function updateLeadStatus(accountId, leadId, status, actorName) {
  const account = await findAccount(accountId);
  if (!account) return { error: 'Account not found.' };
  if (!account.statuses.includes(status)) return { error: 'Unknown pipeline stage.' };

  const { rows } = await pool.query('SELECT * FROM leads WHERE id=$1 AND account_id=$2', [leadId, accountId]);
  if (!rows[0]) return { error: 'Lead not found.' };
  if (rows[0].status === status) return { ok: true };

  await pool.query('UPDATE leads SET status=$1 WHERE id=$2', [status, leadId]);
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, lead_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `${actorName || 'Someone'} moved ${rows[0].name} from ${rows[0].status} to ${status}.`, actorName || null, leadId]
  );
  return { ok: true };
}

async function updateLead(accountId, leadId, { name, company, status, source, value, lastContacted }, actorName) {
  const account = await findAccount(accountId);
  if (!account) return { error: 'Account not found.' };
  const { rows } = await pool.query('SELECT * FROM leads WHERE id=$1 AND account_id=$2', [leadId, accountId]);
  if (!rows[0]) return { error: 'Lead not found.' };
  if (!name || !company) return { error: 'Lead name and company are required.' };
  const validStatus = account.statuses.includes(status) ? status : rows[0].status;

  await pool.query(
    `UPDATE leads SET name=$1, company=$2, status=$3, source=$4, value=$5, last_contacted=$6 WHERE id=$7`,
    [name, company, validStatus, source || 'Manual entry', Number(value) || 0, lastContacted || null, leadId]
  );

  const changeNotes = [];
  if (rows[0].name !== name || rows[0].company !== company) changeNotes.push('details');
  if (rows[0].status !== validStatus) changeNotes.push(`stage (${rows[0].status} → ${validStatus})`);
  if (Number(rows[0].value) !== (Number(value) || 0)) changeNotes.push('value');
  const summary = changeNotes.length ? `${actorName || 'Someone'} updated ${name} — ${changeNotes.join(', ')}.` : `${actorName || 'Someone'} updated ${name}.`;
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, lead_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, summary, actorName || null, leadId]
  );
  return { ok: true };
}

async function getLeadActivity(accountId, leadId) {
  const { rows } = await pool.query(
    'SELECT * FROM activity WHERE account_id=$1 AND lead_id=$2 ORDER BY at DESC LIMIT 50',
    [accountId, leadId]
  );
  return rows.map((r) => ({ id: r.id, text: r.text, actor: r.actor_name, at: new Date(r.at).getTime() }));
}

// ---------- Real Estate CRM: manual leads/brokers/inventory/accounting ----------
const RE_LEAD_STATUSES = ['New', 'Contacted', 'Site Visit', 'Negotiation', 'Closed', 'Lost'];
const RE_INVENTORY_STATUSES = ['Available', 'Reserved', 'Negotiation', 'Sold'];
const RE_ACCOUNTING_STATUSES = ['Pending', 'Received'];
const RE_BROKER_STATUSES = ['Active', 'Inactive'];

// Speed-to-lead SLA enforcement: reassigns any lead still in 'New' status
// whose current broker assignment has gone stale (5+ minutes with no stage
// change) to whichever other active broker currently carries the lightest
// active load. assigned_at resets on every reassignment so a lead can only
// cycle brokers once per 5-minute window, not thrash on every read.
const SPEED_TO_LEAD_SLA_MINUTES = 5;

async function enforceSpeedToLeadSLA(accountId) {
  const { rows: stale } = await pool.query(
    `SELECT id, name, broker_id FROM re_leads
     WHERE account_id=$1 AND status='New' AND broker_id IS NOT NULL
       AND assigned_at IS NOT NULL AND assigned_at < now() - interval '${SPEED_TO_LEAD_SLA_MINUTES} minutes'`,
    [accountId]
  );
  if (!stale.length) return { reassigned: 0 };

  const { rows: brokers } = await pool.query(
    'SELECT id, name FROM re_brokers WHERE account_id=$1 AND status=\'Active\'',
    [accountId]
  );
  if (brokers.length < 2) return { reassigned: 0 };

  const { rows: loadRows } = await pool.query(
    `SELECT broker_id, count(*) AS n FROM re_leads
     WHERE account_id=$1 AND broker_id IS NOT NULL AND status NOT IN ('Closed','Lost')
     GROUP BY broker_id`,
    [accountId]
  );
  const loadByBroker = {};
  brokers.forEach((b) => { loadByBroker[b.id] = 0; });
  loadRows.forEach((r) => { loadByBroker[r.broker_id] = Number(r.n) || 0; });

  let reassigned = 0;
  for (const lead of stale) {
    const candidates = brokers.filter((b) => b.id !== lead.broker_id);
    if (!candidates.length) continue;
    candidates.sort((a, b) => (loadByBroker[a.id] || 0) - (loadByBroker[b.id] || 0));
    const newBroker = candidates[0];
    const oldBroker = brokers.find((b) => b.id === lead.broker_id);

    await pool.query('UPDATE re_leads SET broker_id=$1, assigned_at=now() WHERE id=$2', [newBroker.id, lead.id]);
    loadByBroker[newBroker.id] = (loadByBroker[newBroker.id] || 0) + 1;
    if (oldBroker) loadByBroker[oldBroker.id] = Math.max(0, (loadByBroker[oldBroker.id] || 0) - 1);

    await pool.query(
      'INSERT INTO activity (id, account_id, text, actor_name, re_lead_id) VALUES ($1,$2,$3,$4,$5)',
      [id('act'), accountId, `Ina reassigned ${lead.name} from ${oldBroker ? oldBroker.name : 'a broker'} to ${newBroker.name} — no response within ${SPEED_TO_LEAD_SLA_MINUTES} minutes (speed-to-lead SLA).`, 'Ina', lead.id]
    );
    reassigned++;
  }
  return { reassigned };
}

async function addRELead(accountId, { name, phone, email, source, propertyInterest, budget, status, brokerId, nextFollowup, remarks, nationality }, actorName) {
  if (!name) return { error: 'Lead name is required.' };
  const leadStatus = RE_LEAD_STATUSES.includes(status) ? status : 'New';
  const leadId = id('re_lead');
  await pool.query(
    `INSERT INTO re_leads (id, account_id, name, phone, email, source, property_interest, budget, status, broker_id, date_received, next_followup, remarks, nationality, assigned_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CURRENT_DATE, $11, $12, $13, $14)`,
    [leadId, accountId, name, phone || null, email || null, source || 'Manual Entry', propertyInterest || null, Number(budget) || 0, leadStatus, brokerId || null, nextFollowup || null, remarks || null, nationality || null, brokerId ? new Date() : null]
  );
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, re_lead_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `${actorName || 'Someone'} added a new lead: ${name}.`, actorName || null, leadId]
  );
  return { ok: true, id: leadId };
}

async function updateRELead(accountId, leadId, { name, phone, email, source, propertyInterest, budget, status, brokerId, nextFollowup, remarks, nationality }, actorName) {
  const { rows } = await pool.query('SELECT * FROM re_leads WHERE id=$1 AND account_id=$2', [leadId, accountId]);
  if (!rows[0]) return { error: 'Lead not found.' };
  if (!name) return { error: 'Lead name is required.' };
  const leadStatus = RE_LEAD_STATUSES.includes(status) ? status : rows[0].status;
  const newBrokerId = brokerId || null;
  const brokerChanged = newBrokerId !== rows[0].broker_id;

  await pool.query(
    `UPDATE re_leads SET name=$1, phone=$2, email=$3, source=$4, property_interest=$5, budget=$6, status=$7, broker_id=$8, next_followup=$9, remarks=$10, nationality=$11${brokerChanged ? ', assigned_at=' + (newBrokerId ? 'now()' : 'NULL') : ''}
     WHERE id=$12`,
    [name, phone || null, email || null, source || null, propertyInterest || null, Number(budget) || 0, leadStatus, newBrokerId, nextFollowup || null, remarks || null, nationality || null, leadId]
  );
  const note = rows[0].status !== leadStatus ? ` — stage ${rows[0].status} → ${leadStatus}` : '';
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, re_lead_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `${actorName || 'Someone'} updated lead ${name}${note}.`, actorName || null, leadId]
  );
  return { ok: true };
}

async function addRELeadNote(accountId, leadId, note, actorName) {
  const { rows } = await pool.query('SELECT id, name FROM re_leads WHERE id=$1 AND account_id=$2', [leadId, accountId]);
  if (!rows[0]) return { error: 'Lead not found.' };
  const text = (note || '').trim();
  if (!text) return { error: 'Note text is required.' };
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, re_lead_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `Note: ${text}`, actorName || null, leadId]
  );
  return { ok: true };
}

async function getRELeadActivity(accountId, leadId) {
  const { rows } = await pool.query(
    'SELECT text, actor_name, at FROM activity WHERE account_id=$1 AND re_lead_id=$2 ORDER BY at DESC LIMIT 100',
    [accountId, leadId]
  );
  return rows.map((r) => ({ text: r.text, actor: r.actor_name, at: new Date(r.at).getTime() }));
}

// Bulk-imports leads parsed from an uploaded Excel/CSV file. `rows` is an
// array of plain objects already normalized by the server route (name,
// phone, email, source, propertyInterest, budget, status, broker,
// dateReceived, nextFollowup, nationality, remarks). Matches `broker` by
// name (case-insensitive) against this account's existing brokers.
async function bulkAddRELeads(accountId, rows, actorName) {
  const { rows: brokerRows } = await pool.query('SELECT id, name FROM re_brokers WHERE account_id=$1', [accountId]);
  const brokerByName = {};
  brokerRows.forEach((b) => { brokerByName[String(b.name).trim().toLowerCase()] = b.id; });

  let added = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const name = String(r.name || '').trim();
    if (!name) { errors.push(`Row ${i + 2}: missing a name, skipped.`); continue; }
    const brokerKey = String(r.broker || '').trim().toLowerCase();
    const brokerId = brokerKey ? (brokerByName[brokerKey] || null) : null;
    const status = RE_LEAD_STATUSES.includes(r.status) ? r.status : 'New';
    const leadId = id('re_lead');
    await pool.query(
      `INSERT INTO re_leads (id, account_id, name, phone, email, source, property_interest, budget, status, broker_id, date_received, next_followup, remarks, nationality, assigned_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11::date, CURRENT_DATE), $12, $13, $14, $15)`,
      [leadId, accountId, name, r.phone || null, r.email || null, r.source || 'Excel Import', r.propertyInterest || null,
       Number(r.budget) || 0, status, brokerId, r.dateReceived || null, r.nextFollowup || null, r.remarks || null, r.nationality || null, brokerId ? new Date() : null]
    );
    added++;
  }
  if (added > 0) {
    await pool.query(
      'INSERT INTO activity (id, account_id, text, actor_name) VALUES ($1,$2,$3,$4)',
      [id('act'), accountId, `${actorName || 'Someone'} imported ${added} lead${added === 1 ? '' : 's'} from an Excel file.`, actorName || null]
    );
  }
  return { ok: true, added, skipped: rows.length - added, errors };
}

async function getREBrokerActivity(accountId, brokerId) {
  const { rows } = await pool.query(
    'SELECT text, actor_name, at FROM activity WHERE account_id=$1 AND re_broker_id=$2 ORDER BY at DESC LIMIT 100',
    [accountId, brokerId]
  );
  return rows.map((r) => ({ text: r.text, actor: r.actor_name, at: new Date(r.at).getTime() }));
}

async function getREInventoryActivity(accountId, itemId) {
  const { rows } = await pool.query(
    'SELECT text, actor_name, at FROM activity WHERE account_id=$1 AND re_inventory_id=$2 ORDER BY at DESC LIMIT 100',
    [accountId, itemId]
  );
  return rows.map((r) => ({ text: r.text, actor: r.actor_name, at: new Date(r.at).getTime() }));
}

async function addREBroker(accountId, { name, phone, email, zone, status, salesTarget, revenueAchieved, activeLeads, closedDeals, commissionPct, licenseNo, joinedAt }, actorName) {
  if (!name) return { error: 'Broker name is required.' };
  const brokerStatus = RE_BROKER_STATUSES.includes(status) ? status : 'Active';
  const brokerId = id('re_broker');
  await pool.query(
    `INSERT INTO re_brokers (id, account_id, name, phone, email, zone, active_leads, closed_deals, conversion_pct, commission_pct, sales_target, revenue_achieved, status, license_no, joined_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12,$13,$14)`,
    [brokerId, accountId, name, phone || null, email || null, zone || null, Number(activeLeads) || 0, Number(closedDeals) || 0, commissionPct || null, Number(salesTarget) || 0, Number(revenueAchieved) || 0, brokerStatus, licenseNo || null, joinedAt || null]
  );
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, re_broker_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `${actorName || 'Someone'} added a new broker: ${name}.`, actorName || null, brokerId]
  );
  return { ok: true, id: brokerId };
}

async function updateREBroker(accountId, brokerId, { name, phone, email, zone, status, salesTarget, revenueAchieved, activeLeads, closedDeals, commissionPct, licenseNo, joinedAt }, actorName) {
  const { rows } = await pool.query('SELECT * FROM re_brokers WHERE id=$1 AND account_id=$2', [brokerId, accountId]);
  if (!rows[0]) return { error: 'Broker not found.' };
  if (!name) return { error: 'Broker name is required.' };
  const brokerStatus = RE_BROKER_STATUSES.includes(status) ? status : rows[0].status;

  await pool.query(
    `UPDATE re_brokers SET name=$1, phone=$2, email=$3, zone=$4, active_leads=$5, closed_deals=$6, commission_pct=$7, sales_target=$8, revenue_achieved=$9, status=$10, license_no=$11, joined_at=$12
     WHERE id=$13`,
    [name, phone || null, email || null, zone || null, Number(activeLeads) || 0, Number(closedDeals) || 0, commissionPct || null, Number(salesTarget) || 0, Number(revenueAchieved) || 0, brokerStatus, licenseNo || null, joinedAt || null, brokerId]
  );
  const note = rows[0].status !== brokerStatus ? ` — status ${rows[0].status} → ${brokerStatus}` : '';
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, re_broker_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `${actorName || 'Someone'} updated broker ${name}${note}.`, actorName || null, brokerId]
  );
  return { ok: true };
}

async function addREInventory(accountId, { projectName, unitNo, type, areaSqft, price, status, location, bedrooms, bathrooms, possessionDate, amenities, description, latitude, longitude, images }, actorName) {
  if (!projectName) return { error: 'Project name is required.' };
  const invStatus = RE_INVENTORY_STATUSES.includes(status) ? status : 'Available';
  const itemId = id('re_prop');
  await pool.query(
    `INSERT INTO re_inventory (id, account_id, project_name, unit_no, type, area_sqft, price, status, location, bedrooms, bathrooms, possession_date, amenities, description, latitude, longitude, images)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [itemId, accountId, projectName, unitNo || null, type || null, Number(areaSqft) || null, Number(price) || 0, invStatus, location || null,
      bedrooms === '' || bedrooms === undefined ? null : Number(bedrooms), bathrooms === '' || bathrooms === undefined ? null : Number(bathrooms),
      possessionDate || null, amenities || null, description || null,
      latitude === '' || latitude === undefined ? null : Number(latitude), longitude === '' || longitude === undefined ? null : Number(longitude),
      Array.isArray(images) ? images.filter(Boolean) : []]
  );
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, re_inventory_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `${actorName || 'Someone'} added a new inventory unit: ${projectName}${unitNo ? ' ' + unitNo : ''}.`, actorName || null, itemId]
  );
  return { ok: true, id: itemId };
}

async function updateREInventory(accountId, itemId, { projectName, unitNo, type, areaSqft, price, status, location, bedrooms, bathrooms, possessionDate, amenities, description, latitude, longitude, images }, actorName) {
  const { rows } = await pool.query('SELECT * FROM re_inventory WHERE id=$1 AND account_id=$2', [itemId, accountId]);
  if (!rows[0]) return { error: 'Inventory unit not found.' };
  if (!projectName) return { error: 'Project name is required.' };
  const invStatus = RE_INVENTORY_STATUSES.includes(status) ? status : rows[0].status;

  await pool.query(
    `UPDATE re_inventory SET project_name=$1, unit_no=$2, type=$3, area_sqft=$4, price=$5, status=$6, location=$7,
       bedrooms=$8, bathrooms=$9, possession_date=$10, amenities=$11, description=$12, latitude=$13, longitude=$14, images=$15
     WHERE id=$16`,
    [projectName, unitNo || null, type || null, Number(areaSqft) || null, Number(price) || 0, invStatus, location || null,
      bedrooms === '' || bedrooms === undefined ? null : Number(bedrooms), bathrooms === '' || bathrooms === undefined ? null : Number(bathrooms),
      possessionDate || null, amenities || null, description || null,
      latitude === '' || latitude === undefined ? null : Number(latitude), longitude === '' || longitude === undefined ? null : Number(longitude),
      Array.isArray(images) ? images.filter(Boolean) : (rows[0].images || []),
      itemId]
  );
  const note = rows[0].status !== invStatus ? ` — status ${rows[0].status} → ${invStatus}` : '';
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, re_inventory_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `${actorName || 'Someone'} updated ${projectName}${unitNo ? ' ' + unitNo : ''}${note}.`, actorName || null, itemId]
  );
  return { ok: true };
}

async function addREAccounting(accountId, { txnDate, clientName, property, amount, type, brokerName, paymentMode, status }, actorName) {
  if (!clientName) return { error: 'Client name is required.' };
  const txnStatus = RE_ACCOUNTING_STATUSES.includes(status) ? status : 'Pending';
  const txnId = id('re_txn');
  await pool.query(
    `INSERT INTO re_accounting (id, account_id, txn_date, client_name, property, amount, type, broker_name, payment_mode, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [txnId, accountId, txnDate || null, clientName, property || null, Number(amount) || 0, type || null, brokerName || null, paymentMode || null, txnStatus]
  );
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name) VALUES ($1,$2,$3,$4)',
    [id('act'), accountId, `${actorName || 'Someone'} added a new transaction for ${clientName}.`, actorName || null]
  );
  return { ok: true, id: txnId };
}

async function updateREAccounting(accountId, txnId, { txnDate, clientName, property, amount, type, brokerName, paymentMode, status }, actorName) {
  const { rows } = await pool.query('SELECT * FROM re_accounting WHERE id=$1 AND account_id=$2', [txnId, accountId]);
  if (!rows[0]) return { error: 'Transaction not found.' };
  if (!clientName) return { error: 'Client name is required.' };
  const txnStatus = RE_ACCOUNTING_STATUSES.includes(status) ? status : rows[0].status;

  await pool.query(
    `UPDATE re_accounting SET txn_date=$1, client_name=$2, property=$3, amount=$4, type=$5, broker_name=$6, payment_mode=$7, status=$8 WHERE id=$9`,
    [txnDate || null, clientName, property || null, Number(amount) || 0, type || null, brokerName || null, paymentMode || null, txnStatus, txnId]
  );
  const note = rows[0].status !== txnStatus ? ` — status ${rows[0].status} → ${txnStatus}` : '';
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name) VALUES ($1,$2,$3,$4)',
    [id('act'), accountId, `${actorName || 'Someone'} updated the ${clientName} transaction${note}.`, actorName || null]
  );
  return { ok: true };
}

// ---------- Real Estate CRM: site visits ----------
const RE_SITE_VISIT_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'No-show'];

async function addRESiteVisit(accountId, { leadId, brokerId, inventoryId, scheduledAt, status, notes }, actorName) {
  if (!leadId) return { error: 'A lead is required to schedule a site visit.' };
  const { rows: leadRows } = await pool.query('SELECT name FROM re_leads WHERE id=$1 AND account_id=$2', [leadId, accountId]);
  if (!leadRows[0]) return { error: 'Lead not found.' };
  const visitStatus = RE_SITE_VISIT_STATUSES.includes(status) ? status : 'Scheduled';
  const visitId = id('re_visit');
  await pool.query(
    `INSERT INTO re_site_visits (id, account_id, lead_id, broker_id, inventory_id, scheduled_at, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [visitId, accountId, leadId, brokerId || null, inventoryId || null, scheduledAt || null, visitStatus, notes || null]
  );
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, re_lead_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `${actorName || 'Someone'} scheduled a site visit for ${leadRows[0].name}${scheduledAt ? ' on ' + new Date(scheduledAt).toLocaleString() : ''}.`, actorName || null, leadId]
  );
  return { ok: true, id: visitId };
}

async function updateRESiteVisit(accountId, visitId, { leadId, brokerId, inventoryId, scheduledAt, status, notes }, actorName) {
  const { rows } = await pool.query('SELECT * FROM re_site_visits WHERE id=$1 AND account_id=$2', [visitId, accountId]);
  if (!rows[0]) return { error: 'Site visit not found.' };
  if (!leadId) return { error: 'A lead is required to schedule a site visit.' };
  const { rows: leadRows } = await pool.query('SELECT name FROM re_leads WHERE id=$1 AND account_id=$2', [leadId, accountId]);
  if (!leadRows[0]) return { error: 'Lead not found.' };
  const visitStatus = RE_SITE_VISIT_STATUSES.includes(status) ? status : rows[0].status;

  await pool.query(
    `UPDATE re_site_visits SET lead_id=$1, broker_id=$2, inventory_id=$3, scheduled_at=$4, status=$5, notes=$6 WHERE id=$7`,
    [leadId, brokerId || null, inventoryId || null, scheduledAt || null, visitStatus, notes || null, visitId]
  );
  const note = rows[0].status !== visitStatus ? ` — status ${rows[0].status} → ${visitStatus}` : '';
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, re_lead_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `${actorName || 'Someone'} updated ${leadRows[0].name}'s site visit${note}.`, actorName || null, leadId]
  );
  return { ok: true };
}

// ---------- Real Estate CRM: WhatsApp integration ----------
// Inbound WhatsApp messages either match an existing re_leads row by phone,
// or create a new one (source='WhatsApp') and auto-assign it to whichever
// active broker currently has the lightest load — the same routing scan_inbox
// uses, so a WhatsApp-sourced lead behaves exactly like any other lead from
// the moment it lands: shows up in Leads, counts in dashboard stats, gets
// picked up by the speed-to-lead SLA if it stalls.
function normalizeWAPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function findOrCreateREWALead(accountId, phone, name) {
  const cleanPhone = normalizeWAPhone(phone);
  // Compare digits-only on both sides — manually-added leads (via the
  // Add lead form) store phone exactly as typed, which may include
  // spaces/dashes/a leading "+", none of which `cleanPhone` (from Meta's
  // raw MSISDN) will have. Without this normalization, "+91 9604139376"
  // stored would never match incoming "919604139376" and we'd silently
  // create a duplicate lead instead of matching the existing one.
  const { rows } = await pool.query(
    `SELECT * FROM re_leads WHERE account_id=$1 AND regexp_replace(phone, '\\D', '', 'g') = $2 LIMIT 1`,
    [accountId, cleanPhone]
  );
  if (rows[0]) return rows[0];

  const { rows: brokers } = await pool.query(
    `SELECT b.id, b.name FROM re_brokers b WHERE b.account_id=$1 AND b.status='Active'
     ORDER BY (SELECT count(*) FROM re_leads WHERE broker_id=b.id AND status NOT IN ('Closed','Lost')) ASC
     LIMIT 1`,
    [accountId]
  );
  const broker = brokers[0] || null;

  const leadId = id('re_lead');
  await pool.query(
    `INSERT INTO re_leads (id, account_id, name, phone, source, status, broker_id, date_received, remarks, assigned_at)
     VALUES ($1,$2,$3,$4,'WhatsApp','New',$5, CURRENT_DATE, 'Inbound WhatsApp contact', $6)`,
    [leadId, accountId, name || 'WhatsApp lead', cleanPhone, broker ? broker.id : null, broker ? new Date() : null]
  );
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name, re_lead_id) VALUES ($1,$2,$3,$4,$5)',
    [id('act'), accountId, `New WhatsApp lead: ${name || cleanPhone}${broker ? `, auto-assigned to ${broker.name}` : ' — no active broker available to assign'}.`, 'Ina', leadId]
  );
  const { rows: created } = await pool.query('SELECT * FROM re_leads WHERE id=$1', [leadId]);
  return created[0];
}

async function addREWAMessage(accountId, leadId, direction, message) {
  await pool.query(
    'INSERT INTO re_wa_messages (id, account_id, lead_id, direction, message) VALUES ($1,$2,$3,$4,$5)',
    [id('wa_msg'), accountId, leadId, direction, message]
  );
}

async function getREWAConversation(accountId, leadId, limit) {
  const { rows } = await pool.query(
    `SELECT direction, message, created_at FROM re_wa_messages
     WHERE account_id=$1 AND lead_id=$2 ORDER BY created_at DESC LIMIT $3`,
    [accountId, leadId, limit || 50]
  );
  return rows.reverse().map((r) => ({ direction: r.direction, message: r.message, at: new Date(r.created_at).getTime() }));
}

/** Wipes the stored WhatsApp thread with a lead — the "Clear chat" button.
 * Only clears our own local copy of the conversation; doesn't touch the
 * actual WhatsApp thread on either phone. */
async function clearREWAConversation(accountId, leadId) {
  await pool.query('DELETE FROM re_wa_messages WHERE account_id=$1 AND lead_id=$2', [accountId, leadId]);
}

/** Recent WhatsApp threads for the WhatsApp Integration tab's inbox — one row per lead with a WA message, newest first. */
async function getRecentREWAThreads(accountId, limit) {
  const { rows } = await pool.query(
    `SELECT l.id AS lead_id, l.name, l.phone, l.status, l.wa_conversation_stage,
            m.message AS last_message, m.direction AS last_direction, m.created_at AS last_message_at
     FROM re_leads l
     JOIN LATERAL (
       SELECT message, direction, created_at FROM re_wa_messages
       WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1
     ) m ON true
     WHERE l.account_id=$1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [accountId, limit || 50]
  );
  return rows.map((r) => ({
    leadId: r.lead_id, name: r.name, phone: r.phone, status: r.status, stage: r.wa_conversation_stage,
    lastMessage: r.last_message, lastDirection: r.last_direction, lastMessageAt: new Date(r.last_message_at).getTime()
  }));
}

/** Applies the Claude agent's tool call: bumps wa_conversation_stage, nudges the formal pipeline status at key moments, and logs the change. */
async function applyREWAAgentUpdate(accountId, leadId, { stage, notes }) {
  const { rows } = await pool.query(
    'SELECT name, status, wa_conversation_stage FROM re_leads WHERE id=$1 AND account_id=$2',
    [leadId, accountId]
  );
  if (!rows[0]) return;
  const lead = rows[0];
  const STAGE_TO_STATUS = { booked_viewing: 'Site Visit', not_interested: 'Lost' };
  const newStatus = STAGE_TO_STATUS[stage] || lead.status;

  await pool.query(
    `UPDATE re_leads SET wa_conversation_stage=$1, status=$2,
       remarks = CASE WHEN $3::text IS NOT NULL THEN COALESCE(remarks || E'\n', '') || $3 ELSE remarks END
     WHERE id=$4 AND account_id=$5`,
    [stage || null, newStatus, notes || null, leadId, accountId]
  );

  if (stage && stage !== lead.wa_conversation_stage) {
    const label = {
      in_conversation: 'is now in conversation', needs_human: 'needs human follow-up',
      booked_viewing: 'booked a viewing', not_interested: 'is not interested',
    }[stage] || `moved to ${stage}`;
    await pool.query(
      'INSERT INTO activity (id, account_id, text, actor_name, re_lead_id) VALUES ($1,$2,$3,$4,$5)',
      [id('act'), accountId, `Ina (WhatsApp): ${lead.name} ${label}.`, 'Ina', leadId]
    );
  }
}

async function getRELeadPhone(accountId, leadId) {
  const { rows } = await pool.query('SELECT name, phone FROM re_leads WHERE id=$1 AND account_id=$2', [leadId, accountId]);
  return rows[0] || null;
}

/**
 * Which account inbound WhatsApp messages get attached to. Set
 * WHATSAPP_ACCOUNT_ID in .env to pin it explicitly (needed once more than
 * one real_estate account exists); until then this auto-detects the single
 * real_estate account, so there's nothing to configure for the common case
 * of one Real Estate CRM account (KineSys) using WhatsApp.
 */
async function resolveWhatsAppAccountId() {
  if (process.env.WHATSAPP_ACCOUNT_ID) return process.env.WHATSAPP_ACCOUNT_ID;
  const { rows } = await pool.query(`SELECT id FROM accounts WHERE module_kind='real_estate' ORDER BY starts_at ASC LIMIT 2`);
  if (rows.length === 1) return rows[0].id;
  return null; // none found, or more than one and no WHATSAPP_ACCOUNT_ID override set
}

/**
 * Searches available inventory for the WhatsApp agent's search_properties
 * tool — real listings from the same re_inventory table the Inventory tab
 * shows, so the agent can never invent a property or price.
 */
async function searchREInventory(accountId, { area, property_type, min_price, max_price, min_bedrooms } = {}) {
  const conditions = [`account_id = $1`, `status = 'Available'`];
  const values = [accountId];

  if (area) { values.push(`%${area}%`); conditions.push(`location ILIKE $${values.length}`); }
  if (property_type) { values.push(`%${property_type}%`); conditions.push(`type ILIKE $${values.length}`); }
  if (min_price != null) { values.push(min_price); conditions.push(`price >= $${values.length}`); }
  if (max_price != null) { values.push(max_price); conditions.push(`price <= $${values.length}`); }
  if (min_bedrooms != null) { values.push(min_bedrooms); conditions.push(`bedrooms >= $${values.length}`); }

  const { rows } = await pool.query(
    `SELECT id, project_name, unit_no, type, area_sqft, bedrooms, bathrooms, price, location, description,
            coalesce(array_length(images, 1), 0) AS photo_count
     FROM re_inventory WHERE ${conditions.join(' AND ')}
     ORDER BY price ASC NULLS LAST LIMIT 5`,
    values
  );
  return rows;
}

/** Used by the WhatsApp agent's send_property_photos tool — looks up the
 * public image URLs for one listing so they can be sent as WhatsApp image
 * messages. Scoped to accountId so the agent can't leak another account's
 * inventory even if it hallucinated an id. */
async function getREInventoryImages(accountId, itemId) {
  const { rows } = await pool.query(
    'SELECT project_name, unit_no, images FROM re_inventory WHERE id=$1 AND account_id=$2',
    [itemId, accountId]
  );
  if (!rows[0]) return null;
  return { projectName: rows[0].project_name, unitNo: rows[0].unit_no, images: rows[0].images || [] };
}

// Manager-facing, one-screen rollup: for every broker, target vs. total
// achieved plus what happened *this calendar month* specifically — new
// leads assigned, collections received, deals closed. Built from data
// already on re_leads/re_brokers/re_accounting, no extra schema needed.
async function getREMonthlyReport(accountId) {
  const { rows: brokers } = await pool.query('SELECT * FROM re_brokers WHERE account_id=$1 ORDER BY name', [accountId]);
  const { rows: leads } = await pool.query('SELECT id, broker_id, status, created_at FROM re_leads WHERE account_id=$1', [accountId]);
  const { rows: txns } = await pool.query(
    `SELECT broker_name, amount, status, txn_date FROM re_accounting
     WHERE account_id=$1 AND txn_date IS NOT NULL AND date_trunc('month', txn_date) = date_trunc('month', CURRENT_DATE)`,
    [accountId]
  );

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const report = brokers.map((b) => {
    const leadsThisMonth = leads.filter((l) => l.broker_id === b.id && new Date(l.created_at).getTime() >= monthStart);
    const closedThisMonth = leadsThisMonth.filter((l) => l.status === 'Closed').length;
    const brokerTxns = txns.filter((t) => t.broker_name && t.broker_name.trim().toLowerCase() === String(b.name).trim().toLowerCase());
    const collectionsThisMonth = brokerTxns.filter((t) => t.status === 'Received').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const dealsThisMonth = brokerTxns.length;
    const target = Number(b.sales_target) || 0;
    const achieved = Number(b.revenue_achieved) || 0;
    // Same rule as the broker detail page: active/closed counts come from
    // actual re_leads rows, not the static re_brokers columns.
    const brokerAllLeads = leads.filter((l) => l.broker_id === b.id);
    const activeLeads = brokerAllLeads.filter((l) => l.status !== 'Closed' && l.status !== 'Lost').length;
    const closedDeals = brokerAllLeads.filter((l) => l.status === 'Closed').length;
    const conversionRate = (activeLeads + closedDeals) > 0 ? closedDeals / (activeLeads + closedDeals) : 0;
    return {
      brokerId: b.id, name: b.name, zone: b.zone, status: b.status,
      target, achieved, achievedPct: target > 0 ? achieved / target : 0,
      newLeadsThisMonth: leadsThisMonth.length, closedThisMonth,
      collectionsThisMonth, dealsThisMonth,
      activeLeads, closedDeals, conversionRate
    };
  });

  const totals = report.reduce((acc, r) => ({
    target: acc.target + r.target,
    achieved: acc.achieved + r.achieved,
    newLeadsThisMonth: acc.newLeadsThisMonth + r.newLeadsThisMonth,
    collectionsThisMonth: acc.collectionsThisMonth + r.collectionsThisMonth,
    dealsThisMonth: acc.dealsThisMonth + r.dealsThisMonth
  }), { target: 0, achieved: 0, newLeadsThisMonth: 0, collectionsThisMonth: 0, dealsThisMonth: 0 });

  const topBroker = report.slice().sort((a, b) => b.collectionsThisMonth - a.collectionsThisMonth)[0] || null;

  return { monthLabel, brokers: report, totals, topBrokerName: topBroker && topBroker.collectionsThisMonth > 0 ? topBroker.name : null };
}

// ---------- tasks & reminders (primary admin -> teammates) ----------
async function assignTask(accountId, { assigneeId, title, kind, dueAt }, createdByName) {
  if (!assigneeId || !title) return { error: 'Pick a teammate and a title.' };
  const { rows } = await pool.query('SELECT * FROM team_members WHERE id=$1 AND account_id=$2', [assigneeId, accountId]);
  if (!rows[0]) return { error: 'That teammate was not found on this account.' };

  const taskId = id('task');
  const taskKind = kind === 'reminder' ? 'reminder' : 'task';
  await pool.query(
    `INSERT INTO tasks (id, account_id, assignee_id, assignee_name, created_by, kind, title, status, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)`,
    [taskId, accountId, assigneeId, rows[0].name, createdByName || 'Admin', taskKind, title, dueAt || null]
  );
  const verb = taskKind === 'reminder' ? 'sent a reminder to' : 'assigned a task to';
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name) VALUES ($1,$2,$3,$4)',
    [id('act'), accountId, `${createdByName || 'Admin'} ${verb} ${rows[0].name}: "${title}".`, createdByName || null]
  );
  return { ok: true, id: taskId };
}

async function completeTask(accountId, taskId, actorName) {
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id=$1 AND account_id=$2', [taskId, accountId]);
  if (!rows[0]) return { error: 'Task not found.' };
  if (rows[0].status === 'done') return { ok: true };
  await pool.query('UPDATE tasks SET status=\'done\' WHERE id=$1', [taskId]);
  await pool.query(
    'INSERT INTO activity (id, account_id, text, actor_name) VALUES ($1,$2,$3,$4)',
    [id('act'), accountId, `${actorName || rows[0].assignee_name} marked "${rows[0].title}" done.`, actorName || null]
  );
  return { ok: true };
}

// ---------- account provisioning (super admin only) ----------
const MODULE_PRESETS = {
  sales: {
    label: 'Sales CRM',
    moduleKind: 'pipeline',
    pipelineLabel: 'Leads',
    statuses: ['New', 'Contacted', 'Hot', 'Cold', 'Converted']
  },
  real_estate: {
    label: 'Real Estate CRM',
    moduleKind: 'real_estate'
  }
};

const LICENSE_TERMS = [12, 18, 24, 36, 48];

function generateLicenseNumber() {
  const block = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INA-${block()}-${block()}`;
}

async function createAccount({ name, type, adminName, adminUsername, adminPassword, creditLimit, licenseTermMonths }) {
  const preset = MODULE_PRESETS[type];
  if (!preset) return { error: 'Unknown module type.' };
  if (!name || !adminName || !adminUsername || !adminPassword) {
    return { error: 'Account name and the first admin\'s name, username, and password are all required.' };
  }
  const term = LICENSE_TERMS.includes(Number(licenseTermMonths)) ? Number(licenseTermMonths) : 12;
  const existing = await findUserByUsername(adminUsername);
  if (existing) return { error: 'That username is already in use.' };

  let licenseNumber = generateLicenseNumber();
  for (let attempts = 0; attempts < 5; attempts++) {
    const clash = await pool.query('SELECT 1 FROM accounts WHERE license_number=$1', [licenseNumber]);
    if (!clash.rows[0]) break;
    licenseNumber = generateLicenseNumber();
  }

  const accountId = id('acc');
  await pool.query(
    `INSERT INTO accounts (id, name, type, module_kind, pipeline_label, statuses, status, credit_limit, credits_used, actions_triggered,
       license_number, license_term_months, starts_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,'active',$7,0,0,$8,$9, now(), now() + make_interval(months => $9))`,
    [accountId, name, type, preset.moduleKind, preset.pipelineLabel || 'Leads', preset.statuses || ['New', 'Contacted', 'Hot', 'Cold', 'Converted'], Number(creditLimit) || 5000, licenseNumber, term]
  );
  await addTeamMember(accountId, { name: adminName, username: adminUsername, password: adminPassword }, { bypassCap: true });
  await pool.query('INSERT INTO activity (id, account_id, text) VALUES ($1,$2,$3)', [id('act'), accountId, `Account created by a super admin — ${adminName} set up as the first admin. License ${licenseNumber}, ${term}-month term.`]);
  return { ok: true, accountId, licenseNumber };
}

module.exports = {
  pool, id, hash, rand,
  findUserByUsername, verifyPassword,
  getSuperAdminOverview, toggleAccountStatus, setCreditLimit,
  findAccount, getAccountDetail, runAccountAction, addTeamMember, resetPassword,
  addLead, updateLeadStatus, updateLead, getLeadActivity, assignTask, completeTask,
  addRELead, updateRELead, addREBroker, updateREBroker, addREInventory, updateREInventory, addREAccounting, updateREAccounting,
  addRELeadNote, getRELeadActivity, getREBrokerActivity, getREInventoryActivity,
  bulkAddRELeads, getREMonthlyReport,
  addRESiteVisit, updateRESiteVisit,
  findOrCreateREWALead, addREWAMessage, getREWAConversation, clearREWAConversation, getRecentREWAThreads, applyREWAAgentUpdate, searchREInventory, getREInventoryImages,
  resolveWhatsAppAccountId, getRELeadPhone,
  createAccount, MODULE_PRESETS, LICENSE_TERMS
};
