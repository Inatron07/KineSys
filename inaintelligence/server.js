'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const db = require('./data/db');

const app = express();
const PORT = process.env.PORT || 4100;

app.use(express.json());
app.use(session({
  store: new pgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'inaintelligence-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.auth) return res.status(401).json({ error: 'Not logged in.' });
  next();
}

function canAccessAccount(req, accountId) {
  if (req.session.auth.role === 'super_admin') return true;
  return req.session.auth.accountId === accountId;
}

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Check the server logs.' });
  });
}

// ---------- auth ----------
app.post('/api/login', asyncRoute(async (req, res) => {
  const { username, password } = req.body || {};
  const found = username && await db.findUserByUsername(username);
  if (!found || !db.verifyPassword(password, found.user.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  req.session.auth = {
    role: found.role,
    userId: found.user.id,
    username: found.user.username || username,
    name: found.user.name,
    accountId: found.account ? found.account.id : null,
    isPrimary: found.role === 'super_admin' ? true : !!found.user.isPrimary
  };
  res.json({ ok: true, role: found.role, redirect: found.role === 'super_admin' ? '/super-admin.html' : '/admin.html' });
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, asyncRoute(async (req, res) => {
  const auth = req.session.auth;
  const account = auth.accountId ? await db.findAccount(auth.accountId) : null;
  res.json({
    role: auth.role,
    userId: auth.userId,
    username: auth.username,
    name: auth.name,
    accountId: auth.accountId,
    accountName: account ? account.name : null,
    isPrimary: !!auth.isPrimary
  });
}));

// ---------- super admin ----------
app.get('/api/super-admin/overview', requireAuth, asyncRoute(async (req, res) => {
  if (req.session.auth.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only.' });
  res.json(await db.getSuperAdminOverview());
}));

app.post('/api/super-admin/accounts/:id/status', requireAuth, asyncRoute(async (req, res) => {
  if (req.session.auth.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only.' });
  const status = await db.toggleAccountStatus(req.params.id);
  if (!status) return res.status(404).json({ error: 'Account not found.' });
  res.json({ ok: true, status });
}));

app.post('/api/super-admin/accounts/:id/credit-limit', requireAuth, asyncRoute(async (req, res) => {
  if (req.session.auth.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only.' });
  const limit = Number(req.body && req.body.creditLimit);
  if (!Number.isFinite(limit) || limit < 0) return res.status(400).json({ error: 'Invalid credit limit.' });
  const creditLimit = await db.setCreditLimit(req.params.id, limit);
  if (creditLimit === null) return res.status(404).json({ error: 'Account not found.' });
  res.json({ ok: true, creditLimit });
}));

app.get('/api/super-admin/module-presets', requireAuth, asyncRoute(async (req, res) => {
  if (req.session.auth.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only.' });
  const presets = Object.keys(db.MODULE_PRESETS).map((key) => ({ key, label: db.MODULE_PRESETS[key].label }));
  res.json({ presets, licenseTerms: db.LICENSE_TERMS });
}));

app.post('/api/super-admin/accounts', requireAuth, asyncRoute(async (req, res) => {
  if (req.session.auth.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only.' });
  const { name, type, adminName, adminUsername, adminPassword, creditLimit, licenseTermMonths } = req.body || {};
  const result = await db.createAccount({ name, type, adminName, adminUsername, adminPassword, creditLimit, licenseTermMonths });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, accountId: result.accountId, licenseNumber: result.licenseNumber });
}));

// ---------- account detail (admin, own account; super admin, any account) ----------
app.get('/api/accounts/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const detail = await db.getAccountDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Account not found.' });

  const auth = req.session.auth;
  const viewerIsPrimary = auth.role === 'super_admin' || !!auth.isPrimary;
  const payload = Object.assign({}, detail, { viewerRole: auth.role, viewerIsPrimary: viewerIsPrimary });

  if (!viewerIsPrimary) {
    // Plain team members get a stripped-down CRM: no roster, no credit
    // administration, no account-wide activity feed (that's for the
    // customer admin only), only the "plain" automations for their
    // module, and only the tasks/reminders assigned to them personally.
    payload.team = [];
    payload.activity = [];
    payload.actionsAvailable = detail.actionsAvailable.filter((a) => a.plain);
    payload.tasks = detail.tasks.filter((t) => t.assigneeId === auth.userId);
  }
  payload.myTasks = detail.tasks.filter((t) => t.assigneeId === auth.userId);

  res.json(payload);
}));

app.post('/api/accounts/:id/action', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const account = await db.findAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found.' });
  if (account.status === 'suspended') return res.status(423).json({ error: 'This account is suspended by a super admin.' });

  const auth = req.session.auth;
  const viewerIsPrimary = auth.role === 'super_admin' || !!auth.isPrimary;
  const actionKey = req.body && req.body.action;

  if (!viewerIsPrimary) {
    const detail = await db.getAccountDetail(req.params.id);
    const allowed = detail.actionsAvailable.some((a) => a.key === actionKey && a.plain);
    if (!allowed) return res.status(403).json({ error: 'This action isn\'t available on your account. Ask your admin.' });
  }

  const actorName = auth.role === 'super_admin' ? `Super admin (${auth.name})` : auth.name;
  const result = await db.runAccountAction(req.params.id, actionKey, actorName);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, creditsSpent: result.credits, summary: result.summary });
}));

// ---------- leads (manual entry + pipeline moves — available to every CRM user) ----------
app.post('/api/accounts/:id/leads', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const auth = req.session.auth;
  const actorName = auth.role === 'super_admin' ? `Super admin (${auth.name})` : auth.name;
  const ownerId = auth.role === 'super_admin' ? null : auth.userId;
  const { name, company, status, source, value, lastContacted } = req.body || {};
  const result = await db.addLead(req.params.id, { name, company, status, source, value, lastContacted, ownerId }, actorName);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, id: result.id });
}));

app.post('/api/accounts/:id/leads/:leadId/status', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const auth = req.session.auth;
  const actorName = auth.role === 'super_admin' ? `Super admin (${auth.name})` : auth.name;
  const result = await db.updateLeadStatus(req.params.id, req.params.leadId, req.body && req.body.status, actorName);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

app.post('/api/accounts/:id/leads/:leadId', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const auth = req.session.auth;
  const actorName = auth.role === 'super_admin' ? `Super admin (${auth.name})` : auth.name;
  const { name, company, status, source, value, lastContacted } = req.body || {};
  const result = await db.updateLead(req.params.id, req.params.leadId, { name, company, status, source, value, lastContacted }, actorName);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

app.get('/api/accounts/:id/leads/:leadId/activity', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const activity = await db.getLeadActivity(req.params.id, req.params.leadId);
  res.json({ activity });
}));

// ---------- team management ----------
app.post('/api/accounts/:id/team', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const auth = req.session.auth;
  const viewerIsPrimary = auth.role === 'super_admin' || !!auth.isPrimary;
  if (!viewerIsPrimary) return res.status(403).json({ error: 'Only the primary admin can add team members.' });

  const { name, username, password } = req.body || {};
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username, and password are required.' });
  const bypassCap = auth.role === 'super_admin';
  const result = await db.addTeamMember(req.params.id, { name, username, password }, { bypassCap, addedByName: auth.role === 'super_admin' ? `Super admin (${auth.name})` : auth.name });
  if (result.error) return res.status(409).json({ error: result.error });
  res.json({ ok: true });
}));

app.post('/api/accounts/:id/team/:memberId/reset-password', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const auth = req.session.auth;
  const viewerIsPrimary = auth.role === 'super_admin' || !!auth.isPrimary;
  if (!viewerIsPrimary) return res.status(403).json({ error: 'Only the primary admin can reset a teammate\'s password.' });

  const actorName = auth.role === 'super_admin' ? `Super admin (${auth.name})` : auth.name;
  const result = await db.resetPassword(req.params.id, req.params.memberId, req.body && req.body.newPassword, actorName);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

// ---------- tasks & reminders ----------
app.post('/api/accounts/:id/tasks', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const auth = req.session.auth;
  const viewerIsPrimary = auth.role === 'super_admin' || !!auth.isPrimary;
  if (!viewerIsPrimary) return res.status(403).json({ error: 'Only the primary admin can assign tasks or send reminders.' });

  const { assigneeId, title, kind, dueAt } = req.body || {};
  const createdByName = auth.role === 'super_admin' ? `Super admin (${auth.name})` : auth.name;
  const result = await db.assignTask(req.params.id, { assigneeId, title, kind, dueAt }, createdByName);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, id: result.id });
}));

app.post('/api/accounts/:id/tasks/:taskId/complete', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const auth = req.session.auth;
  const viewerIsPrimary = auth.role === 'super_admin' || !!auth.isPrimary;
  const actorName = auth.role === 'super_admin' ? `Super admin (${auth.name})` : auth.name;

  if (!viewerIsPrimary) {
    const detail = await db.getAccountDetail(req.params.id);
    const owns = detail && detail.tasks.some((t) => t.id === req.params.taskId && t.assigneeId === auth.userId);
    if (!owns) return res.status(403).json({ error: 'You can only complete your own tasks.' });
  }

  const result = await db.completeTask(req.params.id, req.params.taskId, actorName);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, () => {
  console.log(`InaIntelligence running at http://localhost:${PORT}`);
  console.log('First time here? Run "npm run seed" once to create tables and demo logins.');
});
