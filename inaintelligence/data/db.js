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
    [accountId, name, type, preset.moduleKind, preset.pipelineLabel, preset.statuses, Number(creditLimit) || 5000, licenseNumber, term]
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
  createAccount, MODULE_PRESETS, LICENSE_TERMS
};
