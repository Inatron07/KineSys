'use strict';

// Seeds a live "Real Estate CRM" account with the exact dummy data from
// Real_Estate_CRM.xlsx (Leads, Brokers, Property Inventory, Accounting,
// Automation Log). Safe to re-run — skips creating the account/admin if
// it already exists, and skips re-inserting bulk data if it's already there.
//
// Run: npm run seed:realestate  (after `npm run seed` has set up the schema)

const db = require('./db');

const ACCOUNT_NAME = 'Real Estate CRM — Inacio Fernandes';
const ADMIN_NAME = 'Inacio Fernandes';
const ADMIN_USERNAME = 'Inacio Fernandes';
const ADMIN_PASSWORD = '#@llanIna07';

const BROKERS = [
  { name: 'Karan Mehta', phone: '9811122233', email: 'karan.m@agency.com', zone: 'Andheri/Powai', activeLeads: 28, closedDeals: 4, conversionPct: 0.142857142857143, commissionPct: '2%', salesTarget: 50000000, revenueAchieved: 32000000, status: 'Active' },
  { name: 'Sana Iqbal', phone: '9822233344', email: 'sana.i@agency.com', zone: 'BKC/Whitefield', activeLeads: 22, closedDeals: 3, conversionPct: 0.136363636363636, commissionPct: '2%', salesTarget: 60000000, revenueAchieved: 41000000, status: 'Active' },
  { name: 'Vikram Rao', phone: '9833344455', email: 'vikram.r@agency.com', zone: 'Thane/Sohna', activeLeads: 19, closedDeals: 2, conversionPct: 0.105263157894737, commissionPct: '1.5%', salesTarget: 45000000, revenueAchieved: 27500000, status: 'Active' },
  { name: 'Meera Nair', phone: '9844455566', email: 'meera.n@agency.com', zone: 'Powai/BKC', activeLeads: 15, closedDeals: 1, conversionPct: 0.0666666666666667, commissionPct: '1.5%', salesTarget: 30000000, revenueAchieved: 9000000, status: 'Active' },
  { name: 'Arjun Das', phone: '9855566677', email: 'arjun.d@agency.com', zone: 'Andheri', activeLeads: 0, closedDeals: 0, conversionPct: 0, commissionPct: '1.5%', salesTarget: 30000000, revenueAchieved: 0, status: 'Inactive' }
];

const LEADS = [
  { name: 'Rahul Sharma', phone: '9820011223', email: 'rahul.s@gmail.com', source: '99acres', propertyInterest: 'Skyline Heights, Andheri (2BHK)', budget: 9500000, status: 'New', broker: 'Karan Mehta', dateReceived: '2026-08-10', lastFollowup: null, nextFollowup: '2026-08-15', remarks: 'Called, no answer' },
  { name: 'Priya Menon', phone: '9845567781', email: 'priya.m@yahoo.com', source: 'Facebook Ads', propertyInterest: 'Palm Villas, Whitefield (Villa)', budget: 21000000, status: 'Contacted', broker: 'Sana Iqbal', dateReceived: '2026-08-10', lastFollowup: '2026-08-11', nextFollowup: '2026-08-16', remarks: 'Interested, wants brochure' },
  { name: 'Amit Kulkarni', phone: '9765412390', email: 'amitk@outlook.com', source: 'Referral', propertyInterest: 'Oceanview Towers, Powai (3BHK)', budget: 15500000, status: 'Site Visit', broker: 'Vikram Rao', dateReceived: '2026-08-11', lastFollowup: '2026-08-13', nextFollowup: '2026-08-18', remarks: 'Site visit scheduled' },
  { name: 'Neha Thakur', phone: '9900122334', email: 'neha.t@gmail.com', source: 'MagicBricks', propertyInterest: 'Green Meadows Plot, Sohna', budget: 4200000, status: 'Site Visit', broker: 'Karan Mehta', dateReceived: '2026-08-11', lastFollowup: '2026-08-12', nextFollowup: '2026-08-17', remarks: 'Liked the plot' },
  { name: 'Suresh Patil', phone: '9822098765', email: 'suresh.p@rediffmail.com', source: 'Walk-in', propertyInterest: 'Metro Business Park, BKC (Office)', budget: 32000000, status: 'Negotiation', broker: 'Sana Iqbal', dateReceived: '2026-08-12', lastFollowup: '2026-08-13', nextFollowup: '2026-08-15', remarks: 'Negotiating price' },
  { name: 'Divya Reddy', phone: '9845098123', email: 'divya.r@gmail.com', source: 'Website Form', propertyInterest: 'Sunrise Residency, Thane (2BHK)', budget: 8700000, status: 'Closed', broker: 'Vikram Rao', dateReceived: '2026-08-12', lastFollowup: '2026-08-12', nextFollowup: null, remarks: 'Booking confirmed' },
  { name: 'Farhan Sheikh', phone: '9930045567', email: 'farhan.s@gmail.com', source: '99acres', propertyInterest: 'Skyline Heights, Andheri (1BHK)', budget: 6200000, status: 'New', broker: null, dateReceived: '2026-08-13', lastFollowup: null, nextFollowup: '2026-08-14', remarks: 'Auto-captured from portal, pending assignment' }
];

const INVENTORY = [
  { projectName: 'Skyline Heights', unitNo: 'A-1204', type: '2BHK', areaSqft: 1050, price: 9500000, status: 'Available', location: 'Andheri West' },
  { projectName: 'Skyline Heights', unitNo: 'A-1205', type: '1BHK', areaSqft: 720, price: 6200000, status: 'Available', location: 'Andheri West' },
  { projectName: 'Palm Villas', unitNo: 'V-07', type: 'Villa', areaSqft: 3200, price: 21000000, status: 'Available', location: 'Whitefield' },
  { projectName: 'Oceanview Towers', unitNo: 'B-0901', type: '3BHK', areaSqft: 1650, price: 15500000, status: 'Reserved', location: 'Powai' },
  { projectName: 'Green Meadows', unitNo: 'Plot-22', type: 'Plot', areaSqft: 2400, price: 4200000, status: 'Available', location: 'Sohna' },
  { projectName: 'Metro Business Park', unitNo: 'MBP-501', type: 'Office', areaSqft: 2000, price: 32000000, status: 'Negotiation', location: 'BKC' },
  { projectName: 'Sunrise Residency', unitNo: 'C-0302', type: '2BHK', areaSqft: 980, price: 8700000, status: 'Sold', location: 'Thane' }
];

const ACCOUNTING = [
  { txnDate: '2026-08-12', clientName: 'Divya Reddy', property: 'Sunrise Residency C-0302', amount: 500000, type: 'Token Advance', broker: 'Vikram Rao', paymentMode: 'UPI', status: 'Received' },
  { txnDate: '2026-08-12', clientName: 'Divya Reddy', property: 'Sunrise Residency C-0302', amount: 8200000, type: 'Booking Amount', broker: 'Vikram Rao', paymentMode: 'Bank Transfer', status: 'Received' },
  { txnDate: '2026-08-13', clientName: 'Agency', property: '-', amount: 164000, type: 'Commission Payout', broker: 'Vikram Rao', paymentMode: 'Bank Transfer', status: 'Pending' },
  { txnDate: '2026-08-13', clientName: 'Suresh Patil', property: 'Metro Business Park MBP-501', amount: 1000000, type: 'Token Advance', broker: 'Sana Iqbal', paymentMode: 'Cheque', status: 'Received' },
  { txnDate: '2026-08-14', clientName: 'Amit Kulkarni', property: 'Oceanview Towers B-0901', amount: 300000, type: 'Site Visit Deposit', broker: 'Vikram Rao', paymentMode: 'UPI', status: 'Received' }
];

const AUTOMATION_LOG = [
  { trigger: 'New email in leads inbox (99acres)', action: 'Lead LD-1007 created, auto-assigned to next broker in queue', system: 'RPA - Email Parser' },
  { trigger: 'Leads.xlsx row updated on OneDrive', action: 'CRM lead LD-1004 status changed to Site Visit', system: 'Excel/OneDrive Sync' },
  { trigger: 'Payment receipt PDF received', action: 'Matched to TX-5001, Accounting.xlsx updated', system: 'RPA - Doc Extraction' },
  { trigger: 'Broker leads > 25 threshold', action: 'Round-robin reassigned new leads to Meera Nair', system: 'Broker Load Balancer' },
  { trigger: 'No follow-up in 48 hrs (LD-1001)', action: 'Reminder sent to Karan Mehta + escalation flagged', system: 'Follow-up Watcher' }
];

async function main() {
  console.log('Checking for an existing Real Estate CRM account...');
  let accountId;

  const existingAdmin = await db.findUserByUsername(ADMIN_USERNAME);
  if (existingAdmin && existingAdmin.account) {
    accountId = existingAdmin.account.id;
    console.log('Account already exists (' + existingAdmin.account.name + ') — reusing it.');
  } else {
    const result = await db.createAccount({
      name: ACCOUNT_NAME,
      type: 'real_estate',
      adminName: ADMIN_NAME,
      adminUsername: ADMIN_USERNAME,
      adminPassword: ADMIN_PASSWORD,
      creditLimit: 5000,
      licenseTermMonths: 12
    });
    if (result.error) {
      console.error('Could not create the account:', result.error);
      await db.pool.end();
      process.exit(1);
    }
    accountId = result.accountId;
    console.log('Created account. License:', result.licenseNumber);
  }

  const { rows: existingLeads } = await db.pool.query('SELECT count(*) FROM re_leads WHERE account_id=$1', [accountId]);
  if (Number(existingLeads[0].count) > 0) {
    console.log('Dummy data already loaded for this account — nothing more to do.');
    console.log('Login -> ' + ADMIN_USERNAME + ' / (the password you set)');
    await db.pool.end();
    return;
  }

  console.log('Loading brokers...');
  const brokerIdByName = {};
  for (const b of BROKERS) {
    const brokerId = db.id('re_broker');
    brokerIdByName[b.name] = brokerId;
    await db.pool.query(
      `INSERT INTO re_brokers (id, account_id, name, phone, email, zone, active_leads, closed_deals, conversion_pct, commission_pct, sales_target, revenue_achieved, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [brokerId, accountId, b.name, b.phone, b.email, b.zone, b.activeLeads, b.closedDeals, b.conversionPct, b.commissionPct, b.salesTarget, b.revenueAchieved, b.status]
    );
  }

  console.log('Loading leads...');
  for (const l of LEADS) {
    await db.pool.query(
      `INSERT INTO re_leads (id, account_id, name, phone, email, source, property_interest, budget, status, broker_id, date_received, last_followup, next_followup, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [db.id('re_lead'), accountId, l.name, l.phone, l.email, l.source, l.propertyInterest, l.budget, l.status, l.broker ? brokerIdByName[l.broker] || null : null, l.dateReceived, l.lastFollowup, l.nextFollowup, l.remarks]
    );
  }

  console.log('Loading property inventory...');
  for (const i of INVENTORY) {
    await db.pool.query(
      `INSERT INTO re_inventory (id, account_id, project_name, unit_no, type, area_sqft, price, status, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [db.id('re_prop'), accountId, i.projectName, i.unitNo, i.type, i.areaSqft, i.price, i.status, i.location]
    );
  }

  console.log('Loading accounting transactions...');
  for (const t of ACCOUNTING) {
    await db.pool.query(
      `INSERT INTO re_accounting (id, account_id, txn_date, client_name, property, amount, type, broker_name, payment_mode, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [db.id('re_txn'), accountId, t.txnDate, t.clientName, t.property, t.amount, t.type, t.broker, t.paymentMode, t.status]
    );
  }

  console.log('Loading automation log...');
  for (const a of AUTOMATION_LOG) {
    await db.pool.query(
      'INSERT INTO activity (id, account_id, text, actor_name) VALUES ($1,$2,$3,$4)',
      [db.id('act'), accountId, a.trigger + ' → ' + a.action + ' (via ' + a.system + ')', null]
    );
  }

  console.log('Done. Real Estate CRM is seeded and ready.');
  console.log('Login -> ' + ADMIN_USERNAME + ' / (the password you set)');
  await db.pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
