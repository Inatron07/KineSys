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

// All properties are Dubai / greater-Dubai area (Dubai itself, plus the
// neighboring emirates agencies here typically also list — Sharjah, Ajman).
// Prices are AED. `images` are public HTTPS demo/placeholder photos (Picsum,
// a stable placeholder-image service — not real listing photos) so the
// send_property_photos WhatsApp tool and the Inventory modal's photo preview
// have something to show out of the box; swap them for real listing photos
// any time via the Inventory "Edit" modal's Photo URLs field.
// Photo sets for the units below (except Marina Heights 1BHK) come from real
// current Bayut/Luxhabitat listings in these exact areas, per explicit
// instruction — bed/bath/sqft/price were aligned to match whichever listing
// each unit's photos came from, so the numbers you see match what's pictured.
const INVENTORY = [
  { projectName: 'Marina Heights', unitNo: '1204', type: '2BHK', areaSqft: 1284, bedrooms: 2, bathrooms: 3, price: 1900000, status: 'Available', location: 'Dubai Marina', images: [
    'https://images.bayut.com/thumbnails/830238571-800x600.jpeg',
    'https://images.bayut.com/thumbnails/830238572-800x600.jpeg',
    'https://images.bayut.com/thumbnails/830238573-800x600.jpeg',
    'https://images.bayut.com/thumbnails/830238574-800x600.jpeg',
    'https://images.bayut.com/thumbnails/830238575-800x600.jpeg',
    'https://images.bayut.com/thumbnails/830238576-800x600.jpeg'
  ] },
  { projectName: 'Marina Heights', unitNo: '1205', type: '1BHK', areaSqft: 720, bedrooms: 1, bathrooms: 2, price: 1280000, status: 'Available', location: 'Dubai Marina', images: ['https://picsum.photos/id/20/1200/800'] },
  { projectName: 'Palm Jumeirah Signature Villas', unitNo: 'V-07', type: 'Villa', areaSqft: 7000, bedrooms: 5, bathrooms: 6, price: 14000000, status: 'Available', location: 'Palm Jumeirah', images: [
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/e5e70da144b3ac80d34b1cf145c57f7572cc05cab9fcff5426c3093ec43f0628.jpg',
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/44066dff7f44c43d4f88fe183e13908940cbba639708b631dc9db474188adbbb.jpg',
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/3d0c9a6828d2ec0a9f5a6bd0bc92a26720d57a4a5ea74f77e5f191dce8618fbc.jpg',
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/cb35ae82818ce7a680c16383e19faad80e74a3584372b0deed4d0778b40bfbc7.jpg',
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/ea1665918ba9de169dcadf5da03211230daf228f0c2530898454d0c30d85646a.jpg',
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/2e4c7ac0a94fa48ee7fdf0af5468d42ea1b61e1a4e02ea815ca3a17320bd14b4.jpg'
  ] },
  { projectName: 'Downtown Vista', unitNo: '0901', type: '2BHK', areaSqft: 1293, bedrooms: 2, bathrooms: 3, price: 3150000, status: 'Reserved', location: 'Downtown Dubai', images: [
    'https://images.bayut.com/thumbnails/858913655-800x600.jpeg',
    'https://images.bayut.com/thumbnails/858913656-800x600.jpeg',
    'https://images.bayut.com/thumbnails/858913658-800x600.jpeg',
    'https://images.bayut.com/thumbnails/858913660-800x600.jpeg',
    'https://images.bayut.com/thumbnails/858913662-800x600.jpeg',
    'https://images.bayut.com/thumbnails/858913664-800x600.jpeg'
  ] },
  { projectName: 'Dubai Hills Estate Plots', unitNo: 'Plot-22', type: 'Plot', areaSqft: 13423, bedrooms: null, bathrooms: null, price: 32950000, status: 'Available', location: 'Dubai Hills Estate', images: [
    'https://images.bayut.com/thumbnails/849298298-800x600.jpeg',
    'https://images.bayut.com/thumbnails/849298299-800x600.jpeg',
    'https://images.bayut.com/thumbnails/849298300-800x600.jpeg',
    'https://images.bayut.com/thumbnails/849298301-800x600.jpeg',
    'https://images.bayut.com/thumbnails/849298302-800x600.jpeg',
    'https://images.bayut.com/thumbnails/849298303-800x600.jpeg'
  ] },
  { projectName: 'Business Bay Corporate Tower', unitNo: '501', type: 'Office', areaSqft: 2000, bedrooms: null, bathrooms: 2, price: 5750000, status: 'Negotiation', location: 'Business Bay', images: [
    'https://images.bayut.com/thumbnails/836074933-800x600.jpeg',
    'https://images.bayut.com/thumbnails/836074934-800x600.jpeg',
    'https://images.bayut.com/thumbnails/836074935-800x600.jpeg',
    'https://images.bayut.com/thumbnails/836074936-800x600.jpeg',
    'https://images.bayut.com/thumbnails/836074937-800x600.jpeg'
  ] },
  { projectName: 'JVC Sunrise Residences', unitNo: '0302', type: '2BHK', areaSqft: 1055, bedrooms: 2, bathrooms: 3, price: 1350000, status: 'Sold', location: 'Jumeirah Village Circle (JVC)', images: [
    'https://images.bayut.com/thumbnails/861369580-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861369581-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861369582-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861369583-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861369584-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861369585-800x600.jpeg'
  ] },
  { projectName: 'Al Majaz Waterfront Residences', unitNo: '204', type: '2BHK', areaSqft: 1300, bedrooms: 2, bathrooms: 2, price: 43990, status: 'Available', location: 'Sharjah (Al Majaz)', images: [
    'https://images.bayut.com/thumbnails/861377094-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861377095-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861377096-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861377097-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861377158-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861377159-800x600.jpeg'
  ] },
  { projectName: 'Ajman Corniche Towers', unitNo: '1502', type: '1BHK', areaSqft: 1450, bedrooms: 1, bathrooms: 2, price: 52000, status: 'Available', location: 'Ajman Corniche', images: [
    'https://images.bayut.com/thumbnails/840139529-800x600.jpeg',
    'https://images.bayut.com/thumbnails/840139530-800x600.jpeg',
    'https://images.bayut.com/thumbnails/840139531-800x600.jpeg',
    'https://images.bayut.com/thumbnails/840139532-800x600.jpeg',
    'https://images.bayut.com/thumbnails/840139537-800x600.jpeg',
    'https://images.bayut.com/thumbnails/840139538-800x600.jpeg'
  ] }
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

// ---------- Broker lead top-up ----------
// The BROKERS array above states each broker's activeLeads/closedDeals as a
// target (e.g. Karan Mehta: 28 active, 4 closed) — those numbers need to be
// backed by real re_leads rows, or the broker detail page shows a stat box
// that says "28 active leads" next to a list with only 2 leads in it. This
// section tops up whatever's missing with realistic, varied lead records,
// and is safe to re-run: it checks each broker's actual current counts and
// only inserts the shortfall, so running it twice never double-inserts.
const FIRST_NAMES = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan', 'Kabir',
  'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Kiara', 'Myra', 'Anika', 'Navya', 'Riya', 'Sara',
  'Aryan', 'Dhruv', 'Yash', 'Karthik', 'Nikhil', 'Rahul', 'Sanjay', 'Varun', 'Aman', 'Siddharth',
  'Pooja', 'Neha', 'Priya', 'Shreya', 'Kavya', 'Meera', 'Divya', 'Anjali', 'Sneha', 'Isha',
  'Rajesh', 'Suresh', 'Manoj', 'Vikas', 'Ashok', 'Deepak', 'Ramesh', 'Sunil', 'Prakash', 'Anil',
  'Emma', 'James', 'Lena', 'David', 'Fatima', 'Zara', 'Omar', 'Sofia', 'Noah', 'Chloe'];
const LAST_NAMES = ['Sharma', 'Verma', 'Gupta', 'Mehta', 'Kapoor', 'Malhotra', 'Chopra', 'Reddy', 'Rao', 'Nair',
  'Iyer', 'Menon', 'Pillai', 'Krishnan', 'Bhat', 'Kulkarni', 'Patil', 'Deshmukh', 'Joshi', 'Shah',
  'Agarwal', 'Bansal', 'Chatterjee', 'Banerjee', 'Mukherjee', 'Das', 'Sinha', 'Roy', 'Ghosh', 'Sen',
  'Thakur', 'Chauhan', 'Rathore', 'Singh', 'Yadav', 'Pandey', 'Mishra', 'Tripathi', 'Dubey', 'Saxena',
  'Fernandes', 'D\'Souza', 'Pereira', 'Rodrigues', 'Sequeira', 'Carter', 'Muller', 'Whitfield', 'Al-Sayed', 'Ahmed'];
const NATIONALITIES = ['Indian', 'Indian', 'Indian', 'Indian', 'Indian', 'Indian', 'Indian', 'Indian', 'NRI (UAE)', 'British', 'American', 'German'];
const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'rediffmail.com', 'hotmail.com'];
// WhatsApp and Email are weighted heaviest — they're the two channels the
// dashboard's "where did this lead come from" view is built to highlight.
const SOURCES = ['WhatsApp', 'WhatsApp', 'WhatsApp', 'Email', 'Email', '99acres', 'MagicBricks', 'Facebook Ads', 'Instagram Ads', 'Google Ads', 'Referral', 'Website Form', 'Walk-in', 'Cold Canvass'];
const PROPERTY_TAGS = {
  'Skyline Heights': ['1BHK', '2BHK', '3BHK'],
  'Palm Villas': ['Villa'],
  'Oceanview Towers': ['2BHK', '3BHK'],
  'Green Meadows': ['Plot'],
  'Metro Business Park': ['Office'],
  'Sunrise Residency': ['2BHK', '3BHK']
};
const REMARKS_BY_STATUS = {
  New: ['Called, no answer', 'Awaiting first response', 'Auto-captured, pending first call', 'Sent WhatsApp intro message'],
  Contacted: ['Interested, wants brochure', 'Requested more details', 'Discussed budget over call', 'Asked for floor plan'],
  'Site Visit': ['Site visit scheduled', 'Visited site, liked the layout', 'Second site visit requested', 'Comparing with another project'],
  Negotiation: ['Negotiating price', 'Close to finalizing', 'Requested payment plan options', 'Waiting on loan approval'],
  Closed: ['Booking confirmed', 'Deal closed successfully', 'Token amount received, agreement signed', 'Registration completed']
};
const ACTIVE_STATUS_WEIGHTS = ['New', 'New', 'Contacted', 'Contacted', 'Site Visit', 'Site Visit', 'Negotiation'];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

const SEED_WINDOW_START = new Date('2026-06-20T00:00:00Z');
const SEED_WINDOW_END = new Date('2026-08-15T00:00:00Z');

function randomDateReceived() {
  const span = Math.floor((SEED_WINDOW_END.getTime() - SEED_WINDOW_START.getTime()) / 86400000);
  return addDays(SEED_WINDOW_START, randInt(0, span));
}

function makePhone(used) {
  let phone;
  do { phone = '9' + String(randInt(100000000, 999999999)); } while (used.has(phone));
  used.add(phone);
  return phone;
}

function generateLead(broker, status, used) {
  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  const name = first + ' ' + last;
  const projectName = pick(Object.keys(PROPERTY_TAGS));
  const tag = pick(PROPERTY_TAGS[projectName]);
  const dateReceived = randomDateReceived();
  const hasFollowedUp = status !== 'New';
  const lastFollowup = hasFollowedUp ? fmtDate(addDays(dateReceived, randInt(1, 4))) : null;
  const nextFollowup = status === 'Closed' ? null : fmtDate(addDays(dateReceived, randInt(3, 12)));
  return {
    name,
    phone: makePhone(used),
    email: (first + '.' + last).toLowerCase() + '@' + pick(EMAIL_DOMAINS),
    source: pick(SOURCES),
    propertyInterest: projectName + ' (' + tag + ')',
    budget: randInt(42, 380) * 100000,
    status,
    dateReceived: fmtDate(dateReceived),
    lastFollowup,
    nextFollowup,
    nationality: pick(NATIONALITIES),
    remarks: pick(REMARKS_BY_STATUS[status])
  };
}

async function topUpLeads(accountId, brokerIdByName) {
  console.log('Checking broker lead counts and topping up any shortfall...');
  const { rows: existingPhones } = await db.pool.query('SELECT phone FROM re_leads WHERE account_id=$1 AND phone IS NOT NULL', [accountId]);
  const used = new Set(existingPhones.map((r) => r.phone));

  for (const b of BROKERS) {
    if (!b.activeLeads && !b.closedDeals) continue; // e.g. Arjun Das — inactive, 0/0 target
    const brokerId = brokerIdByName[b.name];
    if (!brokerId) continue;

    const { rows } = await db.pool.query(
      `SELECT
         count(*) FILTER (WHERE status NOT IN ('Closed','Lost')) AS active_count,
         count(*) FILTER (WHERE status = 'Closed') AS closed_count
       FROM re_leads WHERE account_id=$1 AND broker_id=$2`,
      [accountId, brokerId]
    );
    const currentActive = Number(rows[0].active_count) || 0;
    const currentClosed = Number(rows[0].closed_count) || 0;
    const needActive = Math.max(0, b.activeLeads - currentActive);
    const needClosed = Math.max(0, b.closedDeals - currentClosed);
    if (needActive === 0 && needClosed === 0) continue;

    console.log(`  ${b.name}: has ${currentActive} active / ${currentClosed} closed, target ${b.activeLeads}/${b.closedDeals} — adding ${needActive} active + ${needClosed} closed...`);
    const toInsert = [];
    for (let i = 0; i < needActive; i++) toInsert.push(generateLead(b, pick(ACTIVE_STATUS_WEIGHTS), used));
    for (let i = 0; i < needClosed; i++) toInsert.push(generateLead(b, 'Closed', used));

    for (const l of toInsert) {
      await db.pool.query(
        `INSERT INTO re_leads (id, account_id, name, phone, email, source, property_interest, budget, status, broker_id, date_received, last_followup, next_followup, remarks, nationality)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [db.id('re_lead'), accountId, l.name, l.phone, l.email, l.source, l.propertyInterest, l.budget, l.status, brokerId, l.dateReceived, l.lastFollowup, l.nextFollowup, l.remarks, l.nationality]
      );
    }
  }
  console.log('Broker lead top-up complete — every broker\'s active/closed stat is now backed by real leads.');
}

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
  const baseDataLoaded = Number(existingLeads[0].count) > 0;
  let brokerIdByName = {};

  if (baseDataLoaded) {
    console.log('Base dummy data already loaded for this account — skipping re-insert.');
    const { rows: brokerRows } = await db.pool.query('SELECT id, name FROM re_brokers WHERE account_id=$1', [accountId]);
    brokerRows.forEach((r) => { brokerIdByName[r.name] = r.id; });
  } else {
    console.log('Loading brokers...');
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
        `INSERT INTO re_inventory (id, account_id, project_name, unit_no, type, area_sqft, price, status, location, images, bedrooms, bathrooms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [db.id('re_prop'), accountId, i.projectName, i.unitNo, i.type, i.areaSqft, i.price, i.status, i.location, i.images || [], i.bedrooms ?? null, i.bathrooms ?? null]
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
  }

  // Always run — idempotent, only inserts whatever shortfall remains between
  // each broker's stated activeLeads/closedDeals and their real lead count.
  await topUpLeads(accountId, brokerIdByName);

  console.log('Done. Real Estate CRM is seeded and ready.');
  console.log('Login -> ' + ADMIN_USERNAME + ' / (the password you set)');
  await db.pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
