'use strict';

// One-off migration for the already-live Real Estate CRM account: relocates
// the original India-based demo inventory (Andheri/Whitefield/Powai/Sohna/
// BKC/Thane) to Dubai and the surrounding emirates, in AED, with demo photo
// URLs — without touching leads, brokers, or accounting.
//
// Why this exists separately from seed-realestate.js: that script's inventory
// block is guarded by "skip if this account already has leads," which is
// true for the live account, so just editing its INVENTORY array wouldn't
// reach rows that already exist in production. This script updates those
// rows in place instead.
//
// Safe to re-run: each UPDATE is matched by the *original* project/unit
// values, so re-running it just re-applies the same new values; each INSERT
// checks for an existing project_name first, so it won't duplicate rows.
//
// Run: node data/update-inventory-dubai.js   (against the account's real
// DATABASE_URL, same as npm run seed / npm run seed:realestate)

const db = require('./db');

const ADMIN_USERNAME = 'Inacio Fernandes';

// Matched against the ORIGINAL seed-realestate.js values (project_name,
// unit_no) so this can find the 7 rows already in production and relocate
// them in place.
const RELOCATIONS = [
  { was: { projectName: 'Skyline Heights', unitNo: 'A-1204' }, now: { projectName: 'Marina Heights', unitNo: '1204', type: '2BHK', areaSqft: 1050, price: 2150000, status: 'Available', location: 'Dubai Marina', images: ['https://picsum.photos/id/10/1200/800'] } },
  { was: { projectName: 'Skyline Heights', unitNo: 'A-1205' }, now: { projectName: 'Marina Heights', unitNo: '1205', type: '1BHK', areaSqft: 720, price: 1280000, status: 'Available', location: 'Dubai Marina', images: ['https://picsum.photos/id/20/1200/800'] } },
  { was: { projectName: 'Palm Villas', unitNo: 'V-07' }, now: { projectName: 'Palm Jumeirah Signature Villas', unitNo: 'V-07', type: 'Villa', areaSqft: 3200, price: 9800000, status: 'Available', location: 'Palm Jumeirah', images: ['https://picsum.photos/id/30/1200/800'] } },
  { was: { projectName: 'Oceanview Towers', unitNo: 'B-0901' }, now: { projectName: 'Downtown Vista', unitNo: '0901', type: '3BHK', areaSqft: 1650, price: 4250000, status: 'Reserved', location: 'Downtown Dubai', images: ['https://picsum.photos/id/40/1200/800'] } },
  { was: { projectName: 'Green Meadows', unitNo: 'Plot-22' }, now: { projectName: 'Dubai Hills Estate Plots', unitNo: 'Plot-22', type: 'Plot', areaSqft: 2400, price: 3600000, status: 'Available', location: 'Dubai Hills Estate', images: ['https://picsum.photos/id/50/1200/800'] } },
  { was: { projectName: 'Metro Business Park', unitNo: 'MBP-501' }, now: { projectName: 'Business Bay Corporate Tower', unitNo: '501', type: 'Office', areaSqft: 2000, price: 5750000, status: 'Negotiation', location: 'Business Bay', images: ['https://picsum.photos/id/60/1200/800'] } },
  { was: { projectName: 'Sunrise Residency', unitNo: 'C-0302' }, now: { projectName: 'JVC Sunrise Residences', unitNo: '0302', type: '2BHK', areaSqft: 980, price: 1150000, status: 'Sold', location: 'Jumeirah Village Circle (JVC)', images: ['https://picsum.photos/id/70/1200/800'] } }
];

// Brand-new "surrounding areas" listings that didn't exist before — inserted
// only if a property with that name isn't already there.
const NEW_LISTINGS = [
  { projectName: 'Al Majaz Waterfront Residences', unitNo: '204', type: '2BHK', areaSqft: 1100, price: 850000, status: 'Available', location: 'Sharjah (Al Majaz)', images: ['https://picsum.photos/id/80/1200/800'] },
  { projectName: 'Ajman Corniche Towers', unitNo: '1502', type: '1BHK', areaSqft: 750, price: 480000, status: 'Available', location: 'Ajman Corniche', images: ['https://picsum.photos/id/90/1200/800'] }
];

async function run() {
  const user = await db.findUserByUsername(ADMIN_USERNAME);
  if (!user || !user.account) {
    console.error('Could not find the "' + ADMIN_USERNAME + '" account — run npm run seed:realestate first.');
    await db.pool.end();
    process.exit(1);
  }
  const accountId = user.account.id;
  console.log('Updating inventory for account:', user.account.name);

  let updated = 0;
  for (const r of RELOCATIONS) {
    const { rowCount } = await db.pool.query(
      `UPDATE re_inventory SET project_name=$1, unit_no=$2, type=$3, area_sqft=$4, price=$5, status=$6, location=$7, images=$8
       WHERE account_id=$9 AND project_name=$10 AND unit_no=$11`,
      [r.now.projectName, r.now.unitNo, r.now.type, r.now.areaSqft, r.now.price, r.now.status, r.now.location, r.now.images,
        accountId, r.was.projectName, r.was.unitNo]
    );
    if (rowCount) { updated += rowCount; console.log('  Relocated:', r.was.projectName, r.was.unitNo, '->', r.now.projectName, r.now.location); }
    else console.log('  Skipped (not found, maybe already relocated):', r.was.projectName, r.was.unitNo);
  }

  let inserted = 0;
  for (const n of NEW_LISTINGS) {
    const { rows } = await db.pool.query('SELECT id FROM re_inventory WHERE account_id=$1 AND project_name=$2', [accountId, n.projectName]);
    if (rows.length) { console.log('  Already exists, skipping:', n.projectName); continue; }
    await db.pool.query(
      `INSERT INTO re_inventory (id, account_id, project_name, unit_no, type, area_sqft, price, status, location, images)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [db.id('re_prop'), accountId, n.projectName, n.unitNo, n.type, n.areaSqft, n.price, n.status, n.location, n.images]
    );
    inserted++;
    console.log('  Added:', n.projectName, n.location);
  }

  console.log(`Done. ${updated} relocated, ${inserted} added.`);
  await db.pool.end();
}

run().catch((err) => { console.error(err); process.exit(1); });
