'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const db = require('./data/db');
const whatsapp = require('./data/whatsappClient');
const whatsappAgent = require('./data/whatsappAgent');
const { extractCfBill } = require('./data/cfExtract');

const app = express();
const PORT = process.env.PORT || 4100;
const leadUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const cfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Behind Render's (or any) reverse proxy, req.protocol/req.get('host') only
// report correctly if Express trusts the X-Forwarded-* headers — needed so
// the WhatsApp tab's Callback URL shows https:// instead of http://.
app.set('trust proxy', 1);

app.use(express.json());
app.use(session({
  store: new pgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'inaintelligence-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Login/admin/super-admin pages must never be served from the browser's
    // back/forward cache or disk cache — otherwise hitting Back or refresh
    // after logout can show a stale, still-"logged in" page without the
    // session-check script re-running.
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

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

// ---------- Real Estate CRM: manual leads/brokers/inventory/accounting ----------
function actorNameFor(auth) {
  return auth.role === 'super_admin' ? `Super admin (${auth.name})` : auth.name;
}

app.post('/api/accounts/:id/re/leads', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const result = await db.addRELead(req.params.id, req.body || {}, actorNameFor(req.session.auth));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, id: result.id });
}));

app.post('/api/accounts/:id/re/leads/:leadId', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const result = await db.updateRELead(req.params.id, req.params.leadId, req.body || {}, actorNameFor(req.session.auth));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

app.get('/api/accounts/:id/re/leads/:leadId/activity', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const activity = await db.getRELeadActivity(req.params.id, req.params.leadId);
  res.json({ activity });
}));

app.post('/api/accounts/:id/re/leads/:leadId/note', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const result = await db.addRELeadNote(req.params.id, req.params.leadId, (req.body || {}).note, actorNameFor(req.session.auth));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

app.post('/api/accounts/:id/re/brokers', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const result = await db.addREBroker(req.params.id, req.body || {}, actorNameFor(req.session.auth));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, id: result.id });
}));

app.post('/api/accounts/:id/re/brokers/:brokerId', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const result = await db.updateREBroker(req.params.id, req.params.brokerId, req.body || {}, actorNameFor(req.session.auth));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

app.get('/api/accounts/:id/re/brokers/:brokerId/activity', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const activity = await db.getREBrokerActivity(req.params.id, req.params.brokerId);
  res.json({ activity });
}));

app.post('/api/accounts/:id/re/inventory', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const result = await db.addREInventory(req.params.id, req.body || {}, actorNameFor(req.session.auth));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, id: result.id });
}));

app.post('/api/accounts/:id/re/inventory/:itemId', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const result = await db.updateREInventory(req.params.id, req.params.itemId, req.body || {}, actorNameFor(req.session.auth));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

app.get('/api/accounts/:id/re/inventory/:itemId/activity', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const activity = await db.getREInventoryActivity(req.params.id, req.params.itemId);
  res.json({ activity });
}));

app.post('/api/accounts/:id/re/accounting', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const result = await db.addREAccounting(req.params.id, req.body || {}, actorNameFor(req.session.auth));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, id: result.id });
}));

app.post('/api/accounts/:id/re/accounting/:txnId', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const result = await db.updateREAccounting(req.params.id, req.params.txnId, req.body || {}, actorNameFor(req.session.auth));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

app.post('/api/accounts/:id/re/site-visits', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const result = await db.addRESiteVisit(req.params.id, req.body || {}, actorNameFor(req.session.auth));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, id: result.id });
}));

app.post('/api/accounts/:id/re/site-visits/:visitId', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const result = await db.updateRESiteVisit(req.params.id, req.params.visitId, req.body || {}, actorNameFor(req.session.auth));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
}));

// Bulk lead import from an uploaded .xlsx/.xls/.csv file. Accepts a
// loosely-matched header row (case/spacing insensitive) so a real
// export from another CRM or a manually-built sheet both work.
function pickCell(row, keys) {
  const normalized = {};
  Object.keys(row).forEach((k) => { normalized[String(k).trim().toLowerCase()] = row[k]; });
  for (const k of keys) {
    if (normalized[k] !== undefined && normalized[k] !== '') return normalized[k];
  }
  return '';
}
function toDateStr(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s || null;
}

app.post('/api/accounts/:id/re/leads/upload', requireAuth, leadUpload.single('file'), asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    return res.status(400).json({ error: 'Could not read that file — make sure it is a valid .xlsx, .xls, or .csv file.' });
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return res.status(400).json({ error: 'That file has no sheets.' });
  const raw = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  if (!raw.length) return res.status(400).json({ error: 'That sheet looks empty.' });
  if (raw.length > 1000) return res.status(400).json({ error: 'That file has too many rows — split it into batches of 1000 or fewer.' });

  const rows = raw.map((r) => ({
    name: pickCell(r, ['name', 'lead name', 'full name']),
    phone: pickCell(r, ['phone', 'phone number', 'mobile', 'contact number']),
    // Optional — if the sheet doesn't have this column, db.withCountryCode()
    // falls back to DEFAULT_COUNTRY_CODE for any phone of 10 digits or fewer.
    countryCode: pickCell(r, ['country code', 'countrycode', 'cc', 'dial code', 'isd code']),
    email: pickCell(r, ['email', 'email address']),
    source: pickCell(r, ['source', 'lead source']),
    propertyInterest: pickCell(r, ['property interest', 'property', 'interest']),
    budget: pickCell(r, ['budget', 'budget (inr)', 'budget (rs)']),
    status: pickCell(r, ['status', 'stage']),
    broker: pickCell(r, ['broker', 'assigned broker', 'broker name', 'owner']),
    dateReceived: toDateStr(pickCell(r, ['date received', 'date', 'received on'])),
    nextFollowup: toDateStr(pickCell(r, ['next follow-up', 'next followup', 'follow up date', 'next follow up'])),
    nationality: pickCell(r, ['nationality']),
    remarks: pickCell(r, ['remarks', 'notes', 'comments'])
  }));

  const result = await db.bulkAddRELeads(req.params.id, rows, actorNameFor(req.session.auth));
  res.json(result);
}));

app.get('/api/accounts/:id/re/monthly-report', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const report = await db.getREMonthlyReport(req.params.id);
  res.json(report);
}));

// ---------- Cash Flow Tracker module ----------
// Ported from the standalone cashflow-tracker app. Two groups of routes:
// authenticated admin routes under /api/accounts/:id/cf/* (same
// canAccessAccount gate as every other account route), and a small public
// group under /api/public/cf/:accountId/* that employees hit from the
// shared submit link (cf-submit.html) with no login at all — mirroring how
// /webhook above is intentionally public. findCfAccount() keeps the public
// routes from doing anything to an account that isn't actually a
// cash_flow-type account.
async function findCfAccount(accountId) {
  const account = await db.findAccount(accountId);
  if (!account || account.type !== 'cash_flow') return null;
  return account;
}

const CF_MONEY_FMT = '#,##0.00';

// ---- authenticated (admin) ----
app.get('/api/accounts/:id/cf/people', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  res.json(await db.getCfPeople(req.params.id));
}));

app.post('/api/accounts/:id/cf/people', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const person = await db.addCfPerson(req.params.id, req.body && req.body.name);
  res.json(person);
}));

app.post('/api/accounts/:id/cf/received', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const { personId, amount, counterparty, txnDate, submittedBy, notes } = req.body || {};
  if (!personId) return res.status(400).json({ error: 'Select a name.' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Enter an amount.' });
  const row = await db.addCfReceived(req.params.id, { personId, amount: Number(amount), counterparty, txnDate, submittedBy, notes });
  res.json({ ok: true, transaction: row });
}));

app.get('/api/accounts/:id/cf/summaries', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const { from, to } = req.query;
  res.json(await db.getCfPersonSummaries(req.params.id, { from: from || null, to: to || null }));
}));

// Clears the green "new" badge — call when the admin selects a person.
app.post('/api/accounts/:id/cf/people/:personId/mark-seen', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  await db.markCfPersonSeen(req.params.id, req.params.personId);
  res.json({ ok: true });
}));

app.get('/api/accounts/:id/cf/transactions', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const { personId, from, to } = req.query;
  res.json(await db.listCfTransactions(req.params.id, { personId: personId || null, from: from || null, to: to || null }));
}));

// Day-by-day ledger for one person — same shape as their Excel sheet
// (WEEK+Date merged into one Date field here), used to render the admin
// table with the same columns as the export instead of a flat event log.
app.get('/api/accounts/:id/cf/ledger', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const { personId, from, to } = req.query;
  if (!personId) return res.status(400).json({ error: 'personId is required.' });
  res.json(await db.getCfPersonDailyLedger(req.params.id, personId, from || null, to || null));
}));

app.get('/api/accounts/:id/cf/transactions/:txnId/image', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const row = await db.getCfTransactionImage(req.params.id, req.params.txnId);
  if (!row || !row.image_data) return res.status(404).end();
  res.set('Content-Type', row.image_mime || 'application/octet-stream');
  res.send(row.image_data);
}));

app.post('/api/accounts/:id/cf/transactions/:txnId/confirm', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const { amount, counterparty } = req.body || {};
  const row = await db.confirmCfTransaction(req.params.id, req.params.txnId, { amount, counterparty, reviewedBy: actorNameFor(req.session.auth) });
  if (!row) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
}));

app.delete('/api/accounts/:id/cf/transactions/:txnId', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const ok = await db.deleteCfTransaction(req.params.id, req.params.txnId);
  if (!ok) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
}));

// POST (not DELETE-with-body) so this works reliably behind any proxy/client
// that strips bodies from DELETE requests.
app.post('/api/accounts/:id/cf/transactions/bulk-delete', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'No ids provided.' });
  const count = await db.deleteCfTransactions(req.params.id, ids);
  res.json({ ok: true, deleted: count });
}));

// Mirrors the client's original per-person workbook: one sheet per person,
// one row per calendar day (not per transaction), with a running
// PREVIOUS BALANCE -> Total cash in hand -> Total expense -> BALANCE chain
// carried from day to day, same as their existing sheets.
app.get('/api/accounts/:id/cf/export.xlsx', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const { from, to } = req.query;
  const people = await db.getCfPeople(req.params.id);
  const wb = new ExcelJS.Workbook();
  const groupFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A44' } };

  for (const person of people) {
    const ledger = await db.getCfPersonDailyLedger(req.params.id, person.id, from || null, to || null);
    const ws = wb.addWorksheet(person.name.slice(0, 31)); // Excel sheet-name length limit

    // 13 columns, A through M — matches the client's original sheet
    // position-for-position, including the always-blank "Altaf" column
    // (column E in their template).
    ws.columns = [
      { width: 12 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 10 },
      { width: 14 }, { width: 16 }, { width: 14 }, { width: 16 },
      { width: 14 }, { width: 16 }, { width: 16 }, { width: 14 },
    ];

    ws.mergeCells('A1:M1');
    ws.getCell('A1').value = `Cash Flow Record — ${person.name}`;
    ws.getCell('A1').font = { bold: true, size: 13 };

    ws.mergeCells('A2:M2');
    ws.getCell('A2').value = `${ledger.from} to ${ledger.to}`;
    ws.getCell('A2').font = { italic: true, color: { argb: 'FF8D9AC0' } };

    const headerRow = ws.getRow(3);
    const subRow = ws.getRow(4);
    const singleCols = [
      ['A', 'WEEK'], ['B', 'Date'], ['C', 'PREVIOUS BALANCE'], ['D', 'Received Amount (AED)'],
      ['E', 'Altaf'], ['J', 'BILL AMOUNT'], ['K', 'Total cashin hand'], ['L', 'Total expense'], ['M', 'BALANCE'],
    ];
    singleCols.forEach(([col, label]) => {
      ws.mergeCells(`${col}3:${col}4`);
      ws.getCell(`${col}3`).value = label;
    });
    ws.mergeCells('F3:G3');
    ws.getCell('F3').value = 'OTHERS (RECEIVED)';
    ws.getCell('F4').value = 'AMOUNT';
    ws.getCell('G4').value = 'NAME';
    ws.mergeCells('H3:I3');
    ws.getCell('H3').value = 'NO BILL (PAID)';
    ws.getCell('H4').value = 'BILL AMOUNT';
    ws.getCell('I4').value = 'NAME';

    [headerRow, subRow].forEach((row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { bold: true, color: { argb: 'FFEEF1F8' } };
        cell.fill = groupFill;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
    });

    let r = 5;
    ledger.days.forEach((d) => {
      const row = ws.getRow(r);
      row.getCell(1).value = d.week;
      row.getCell(2).value = d.date;
      row.getCell(2).numFmt = 'dd-mmm-yyyy';
      row.getCell(3).value = d.previousBalance;
      row.getCell(4).value = d.receivedAmount || null;
      row.getCell(6).value = d.othersReceivedAmount || null;
      row.getCell(7).value = d.othersReceivedName || '';
      row.getCell(8).value = d.noBillAmount || null;
      row.getCell(9).value = d.noBillName || '';
      row.getCell(10).value = d.billAmount || null;
      row.getCell(11).value = d.totalCashInHand;
      row.getCell(12).value = d.totalExpense;
      row.getCell(13).value = d.balance;
      [3, 4, 6, 8, 10, 11, 12, 13].forEach((c) => { row.getCell(c).numFmt = CF_MONEY_FMT; });
      r += 1;
    });

    ws.views = [{ state: 'frozen', ySplit: 4 }];
  }

  if (!wb.worksheets.length) wb.addWorksheet('No data');

  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="cashflow-export.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// ---- public (shared submit link, no login) ----
app.get('/api/public/cf/:accountId/people', asyncRoute(async (req, res) => {
  const account = await findCfAccount(req.params.accountId);
  if (!account) return res.status(404).json({ error: 'Submit link not found.' });
  res.json(await db.getCfPeople(req.params.accountId));
}));

app.post('/api/public/cf/:accountId/transactions/no-bill', asyncRoute(async (req, res) => {
  const account = await findCfAccount(req.params.accountId);
  if (!account) return res.status(404).json({ error: 'Submit link not found.' });
  const { personId, amount, counterparty, txnDate, submittedBy, notes } = req.body || {};
  if (!personId) return res.status(400).json({ error: 'Select a name.' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Enter an amount.' });
  const row = await db.addCfNoBill(req.params.accountId, { personId, amount: Number(amount), counterparty, txnDate, submittedBy, notes });
  res.json({ ok: true, transaction: row });
}));

app.post('/api/public/cf/:accountId/transactions/bill', cfUpload.single('file'), asyncRoute(async (req, res) => {
  const account = await findCfAccount(req.params.accountId);
  if (!account) return res.status(404).json({ error: 'Submit link not found.' });
  const { personId, amount, txnDate, submittedBy, notes } = req.body || {};
  if (!personId) return res.status(400).json({ error: 'Select a name.' });
  if (!req.file) return res.status(400).json({ error: 'Upload or photograph the bill.' });

  const extraction = await extractCfBill(req.file.buffer, req.file.mimetype);

  // If the submitter also typed an amount, cross-check it against what
  // Claude read off the bill — a mismatch is just as good a "look at this"
  // signal as Claude's own low confidence, forcing a review either way.
  let finalExtraction = extraction;
  const typedAmount = amount ? Number(amount) : null;
  if (extraction && typedAmount && Math.abs(extraction.amount - typedAmount) > Math.max(1, typedAmount * 0.02)) {
    finalExtraction = {
      ...extraction,
      confidence: Math.min(extraction.confidence, 0.4),
      notes: [extraction.notes, `Typed amount (${typedAmount}) doesn't match what was read off the bill (${extraction.amount}).`].filter(Boolean).join(' '),
    };
  }

  const finalAmount = typedAmount || (extraction ? extraction.amount : 0);
  const row = await db.addCfBill(req.params.accountId, {
    personId,
    amount: finalAmount,
    counterparty: extraction?.vendor || null,
    txnDate: txnDate || extraction?.date || null,
    imageBuffer: req.file.buffer,
    imageMime: req.file.mimetype,
    extraction: finalExtraction,
    submittedBy,
    notes,
  });
  res.json({ ok: true, transaction: row, extraction: finalExtraction });
}));

// ---------- Real Estate CRM: WhatsApp integration ----------
// The webhook itself (GET/POST /webhook) is intentionally public — Meta
// calls it directly, with no session. It's not scoped to :id in the URL;
// db.resolveAccountByPhoneNumberId() figures out which account owns it by
// matching the phone_number_id Meta includes in the payload against each
// account's own re_whatsapp_config row (falling back to the legacy single
// .env-configured account when it matches WHATSAPP_PHONE_NUMBER_ID). This is
// what lets multiple real_estate accounts each run their own WhatsApp
// number. Everything else below is a normal authenticated account route.

app.get('/webhook', (req, res) => {
  const challenge = whatsapp.verifyWebhookChallenge(req.query);
  if (challenge) {
    console.log('[webhook] verification succeeded');
    return res.status(200).send(challenge);
  }
  console.warn('[webhook] verification failed — check WHATSAPP_VERIFY_TOKEN matches the Meta dashboard');
  return res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  // Always ack fast — WhatsApp retries aggressively if you don't 200 quickly.
  res.sendStatus(200);
  console.log('[webhook] POST received', JSON.stringify(req.body).slice(0, 500));

  const statusUpdate = whatsapp.parseStatusUpdate(req.body);
  if (statusUpdate) {
    // statusUpdate.phoneNumberId isn't needed for the status-save itself
    // (we match by wamid, which is globally unique), but logged for parity.
    const errSuffix = statusUpdate.status === 'failed'
      ? ` — error ${statusUpdate.errorCode}: ${statusUpdate.errorTitle || statusUpdate.errorDetail || '(no detail)'}`
      : '';
    console.log(`[webhook] delivery status for ${statusUpdate.waMessageId}: ${statusUpdate.status}${errSuffix}`);
    const detail = statusUpdate.status === 'failed'
      ? `${statusUpdate.errorCode ? `#${statusUpdate.errorCode} ` : ''}${statusUpdate.errorTitle || statusUpdate.errorDetail || 'Delivery failed'}`
      : null;
    db.updateREWAMessageStatus(statusUpdate.waMessageId, statusUpdate.status, detail).catch((err) => {
      console.error('[webhook] error saving delivery status', err);
    });
    return;
  }

  const incoming = whatsapp.parseIncomingMessage(req.body);
  if (!incoming) {
    console.log('[webhook] not a user message or status update — ignoring');
    return;
  }
  console.log(`[webhook] parsed inbound message from ${incoming.from} (${incoming.name || 'no name'}): ${incoming.text}`);
  handleIncomingWhatsAppMessage(incoming).catch((err) => {
    console.error('[webhook] error handling incoming message', err);
  });
});

async function handleIncomingWhatsAppMessage(incoming) {
  // Route by the phone_number_id Meta sent this on, so each real_estate
  // account with its own WhatsApp number only sees its own conversations.
  // Falls back to the legacy single-account resolution for the original
  // demo account (its number lives in .env, not re_whatsapp_config).
  const accountId = await db.resolveAccountByPhoneNumberId(incoming.phoneNumberId);
  if (!accountId) {
    console.warn(`[webhook] no account found for phone_number_id ${incoming.phoneNumberId} — is it registered in re_whatsapp_config or WHATSAPP_PHONE_NUMBER_ID?`);
    return;
  }
  const waConfig = await db.getEffectiveWhatsAppConfig(accountId);
  const creds = { phoneNumberId: waConfig.phoneNumberId, accessToken: waConfig.accessToken };

  const lead = await db.findOrCreateREWALead(accountId, incoming.from, incoming.name);
  console.log(`[webhook] matched/created lead ${lead.id} (${lead.name}, phone on file: ${lead.phone})`);
  await db.addREWAMessage(accountId, lead.id, 'in', incoming.text);

  if (!whatsappAgent.isConfigured()) {
    console.warn('[webhook] ANTHROPIC_API_KEY not set — message logged but no auto-reply sent.');
    return;
  }

  const history = await db.getREWAConversation(accountId, lead.id, 20);
  // history already includes the message we just logged — drop it, since
  // generateReply takes prior history + the current message separately.
  const { replyText, stageUpdate } = await whatsappAgent.generateReply(accountId, lead, history.slice(0, -1), incoming.text, waConfig);
  console.log(`[webhook] agent reply: ${replyText ? JSON.stringify(replyText).slice(0, 300) : '(none)'}, stage: ${stageUpdate?.stage || '(none)'}`);

  if (replyText) {
    const result = await whatsapp.sendTextMessage(incoming.from, replyText, creds);
    await db.addREWAMessage(accountId, lead.id, 'out', replyText, result?.messages?.[0]?.id);
    console.log('[webhook] reply sent to', incoming.from);
  }
  if (stageUpdate && stageUpdate.stage) {
    await db.applyREWAAgentUpdate(accountId, lead.id, stageUpdate);
  }
}

app.get('/api/accounts/:id/re/whatsapp/status', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const waConfig = await db.getEffectiveWhatsAppConfig(req.params.id);
  const resolvedAccountId = await db.resolveAccountByPhoneNumberId(waConfig.phoneNumberId);
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json({
    whatsappConfigured: !!(waConfig.phoneNumberId && waConfig.accessToken),
    agentConfigured: whatsappAgent.isConfigured(),
    wiredToThisAccount: !!resolvedAccountId && resolvedAccountId === req.params.id,
    resolvedAccountId: resolvedAccountId || null,
    callbackUrl: `${base}/webhook`,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || null, // shared across all accounts — see whatsappClient.js
    templateName: waConfig.templateName || null,
    templateLang: waConfig.templateLang || 'en',
    configSource: waConfig.source, // 'account' (own re_whatsapp_config row) or 'env' (legacy demo account)
  });
}));

// Per-account WhatsApp Business setup — lets a real_estate customer plug in
// their own number instead of riding on the shared .env-configured one.
// Never returns the stored access_token itself, only whether one's on file.
app.get('/api/accounts/:id/re/whatsapp/config', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const config = await db.getREWhatsAppConfigForUI(req.params.id);
  res.json(config || {});
}));

app.put('/api/accounts/:id/re/whatsapp/config', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const {
    phoneNumberId, accessToken, businessNumber, templateName, templateLang,
    agentName, businessName, businessContext,
  } = req.body || {};
  if (!phoneNumberId || !phoneNumberId.trim()) return res.status(400).json({ error: 'Phone number ID is required.' });
  // accessToken is optional on update — omit it to keep the existing token on file (e.g. only changing the template name).
  let finalAccessToken = accessToken;
  if (!finalAccessToken) {
    const { rows } = await db.pool.query('SELECT access_token FROM re_whatsapp_config WHERE account_id=$1', [req.params.id]);
    finalAccessToken = rows[0]?.access_token || null;
  }
  await db.upsertREWhatsAppConfig(req.params.id, {
    phoneNumberId: phoneNumberId.trim(),
    accessToken: finalAccessToken,
    businessNumber, templateName, templateLang, agentName, businessName, businessContext,
  });
  res.json({ ok: true });
}));

app.get('/api/accounts/:id/re/whatsapp/conversations', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const threads = await db.getRecentREWAThreads(req.params.id);
  res.json(threads);
}));

app.get('/api/accounts/:id/re/whatsapp/conversations/:leadId', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const messages = await db.getREWAConversation(req.params.id, req.params.leadId, 100);
  res.json(messages);
}));

app.delete('/api/accounts/:id/re/whatsapp/conversations/:leadId', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  await db.clearREWAConversation(req.params.id, req.params.leadId);
  res.json({ ok: true });
}));

app.post('/api/accounts/:id/re/whatsapp/send', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const { leadId, text } = req.body || {};
  if (!leadId || !text || !text.trim()) return res.status(400).json({ error: 'leadId and text are required.' });
  const lead = await db.getRELeadPhone(req.params.id, leadId);
  if (!lead || !lead.phone) return res.status(400).json({ error: 'This lead has no phone number on file.' });
  try {
    const waConfig = await db.getEffectiveWhatsAppConfig(req.params.id);
    const creds = { phoneNumberId: waConfig.phoneNumberId, accessToken: waConfig.accessToken };
    const result = await whatsapp.sendTextMessage(lead.phone, text.trim(), creds);
    await db.addREWAMessage(req.params.id, leadId, 'out', text.trim(), result?.messages?.[0]?.id);
    res.json({ ok: true });
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: detail });
  }
}));

app.post('/api/accounts/:id/re/whatsapp/send-template', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const { leadId } = req.body || {};
  if (!leadId) return res.status(400).json({ error: 'leadId is required.' });
  const lead = await db.getRELeadPhone(req.params.id, leadId);
  if (!lead || !lead.phone) return res.status(400).json({ error: 'This lead has no phone number on file.' });
  const waConfig = await db.getEffectiveWhatsAppConfig(req.params.id);
  if (!waConfig.templateName) return res.status(400).json({ error: 'No outreach template configured for this account yet — set it up in WhatsApp Integration → Setup.' });
  const firstName = (lead.name || 'there').split(' ')[0];
  try {
    // The approved "kinesys" template's body has no {{1}}/{{2}} placeholders,
    // so no body parameters are sent — passing any breaks Meta's param-count
    // check (#132000 "Number of parameters does not match..."). If you ever
    // approve a template with variables, add them back here to match.
    const creds = { phoneNumberId: waConfig.phoneNumberId, accessToken: waConfig.accessToken };
    const result = await whatsapp.sendTemplateMessage(lead.phone, waConfig.templateName, waConfig.templateLang, [], creds);
    await db.addREWAMessage(req.params.id, leadId, 'out', `[template: ${waConfig.templateName}] outreach message sent to ${firstName}`, result?.messages?.[0]?.id);
    res.json({ ok: true });
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    // Record the failed attempt in the lead's WhatsApp history too, not just
    // the API error response — otherwise a failed send leaves no trace once
    // this response is gone, and it looks like the lead was never contacted.
    await db.addREWAMessage(req.params.id, leadId, 'out', `[template: ${waConfig.templateName}] outreach send FAILED to ${firstName}`, null, { status: 'failed', statusDetail: detail });
    res.status(500).json({ error: detail });
  }
}));

app.post('/api/accounts/:id/re/whatsapp/bulk-send-template', requireAuth, asyncRoute(async (req, res) => {
  if (!canAccessAccount(req, req.params.id)) return res.status(403).json({ error: 'Not authorized for this account.' });
  const { leadIds } = req.body || {};
  if (!Array.isArray(leadIds) || !leadIds.length) return res.status(400).json({ error: 'leadIds (non-empty array) is required.' });
  const waConfig = await db.getEffectiveWhatsAppConfig(req.params.id);
  if (!waConfig.templateName) return res.status(400).json({ error: 'No outreach template configured for this account yet — set it up in WhatsApp Integration → Setup.' });
  const creds = { phoneNumberId: waConfig.phoneNumberId, accessToken: waConfig.accessToken };

  const results = [];
  // Sequential, not Promise.all — WhatsApp's API rate-limits bursts of
  // outbound template sends, so we go one at a time rather than firing a
  // dozen requests at once.
  for (const leadId of leadIds) {
    const lead = await db.getRELeadPhone(req.params.id, leadId);
    if (!lead || !lead.phone) {
      results.push({ leadId, ok: false, error: 'No phone number on file.' });
      continue;
    }
    const firstName = (lead.name || 'there').split(' ')[0];
    try {
      const result = await whatsapp.sendTemplateMessage(lead.phone, waConfig.templateName, waConfig.templateLang, [], creds);
      await db.addREWAMessage(req.params.id, leadId, 'out', `[template: ${waConfig.templateName}] outreach message sent to ${firstName}`, result?.messages?.[0]?.id);
      results.push({ leadId, ok: true });
    } catch (err) {
      const detail = err.response?.data?.error?.message || err.message;
      // Same as the single-send route: log the failure onto the lead so it's
      // visible later in their WhatsApp panel, not just in this response.
      await db.addREWAMessage(req.params.id, leadId, 'out', `[template: ${waConfig.templateName}] outreach send FAILED to ${firstName}`, null, { status: 'failed', statusDetail: detail });
      results.push({ leadId, ok: false, error: detail });
    }
  }

  const sent = results.filter((r) => r.ok).length;
  res.json({ sent, failed: results.length - sent, results });
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
