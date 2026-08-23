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
// Photo sets (except Marina Heights 1BHK) come from real current Bayut/
// Luxhabitat listings in these exact areas, per explicit instruction —
// bed/bath/sqft/price were aligned to match whichever listing each unit's
// photos came from, so the numbers shown match what's pictured.
const RELOCATIONS = [
  { was: { projectName: 'Skyline Heights', unitNo: 'A-1204' }, now: { projectName: 'Marina Heights', unitNo: '1204', type: '2BHK', areaSqft: 1284, bedrooms: 2, bathrooms: 3, price: 1900000, status: 'Available', location: 'Dubai Marina', images: [
    'https://images.bayut.com/thumbnails/830238571-800x600.jpeg',
    'https://images.bayut.com/thumbnails/830238572-800x600.jpeg',
    'https://images.bayut.com/thumbnails/830238573-800x600.jpeg',
    'https://images.bayut.com/thumbnails/830238574-800x600.jpeg',
    'https://images.bayut.com/thumbnails/830238575-800x600.jpeg',
    'https://images.bayut.com/thumbnails/830238576-800x600.jpeg'
  ] } },
  { was: { projectName: 'Skyline Heights', unitNo: 'A-1205' }, now: { projectName: 'Marina Heights', unitNo: '1205', type: '1BHK', areaSqft: 1011, bedrooms: 1, bathrooms: 2, price: 1574000, status: 'Available', location: 'Dubai Marina', images: [
    'https://images.bayut.com/thumbnails/861132256-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861132257-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861132258-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861132259-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861132260-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861132261-800x600.jpeg'
  ] } },
  { was: { projectName: 'Palm Villas', unitNo: 'V-07' }, now: { projectName: 'Palm Jumeirah Signature Villas', unitNo: 'V-07', type: 'Villa', areaSqft: 7000, bedrooms: 5, bathrooms: 6, price: 14000000, status: 'Available', location: 'Palm Jumeirah', images: [
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/e5e70da144b3ac80d34b1cf145c57f7572cc05cab9fcff5426c3093ec43f0628.jpg',
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/44066dff7f44c43d4f88fe183e13908940cbba639708b631dc9db474188adbbb.jpg',
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/3d0c9a6828d2ec0a9f5a6bd0bc92a26720d57a4a5ea74f77e5f191dce8618fbc.jpg',
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/cb35ae82818ce7a680c16383e19faad80e74a3584372b0deed4d0778b40bfbc7.jpg',
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/ea1665918ba9de169dcadf5da03211230daf228f0c2530898454d0c30d85646a.jpg',
    'https://luxhabitat.ae/resizedimages/560w/development/92/source/2e4c7ac0a94fa48ee7fdf0af5468d42ea1b61e1a4e02ea815ca3a17320bd14b4.jpg'
  ] } },
  { was: { projectName: 'Oceanview Towers', unitNo: 'B-0901' }, now: { projectName: 'Downtown Vista', unitNo: '0901', type: '2BHK', areaSqft: 1293, bedrooms: 2, bathrooms: 3, price: 3150000, status: 'Reserved', location: 'Downtown Dubai', images: [
    'https://images.bayut.com/thumbnails/858913655-800x600.jpeg',
    'https://images.bayut.com/thumbnails/858913656-800x600.jpeg',
    'https://images.bayut.com/thumbnails/858913658-800x600.jpeg',
    'https://images.bayut.com/thumbnails/858913660-800x600.jpeg',
    'https://images.bayut.com/thumbnails/858913662-800x600.jpeg',
    'https://images.bayut.com/thumbnails/858913664-800x600.jpeg'
  ] } },
  { was: { projectName: 'Green Meadows', unitNo: 'Plot-22' }, now: { projectName: 'Dubai Hills Estate Plots', unitNo: 'Plot-22', type: 'Plot', areaSqft: 13423, bedrooms: null, bathrooms: null, price: 32950000, status: 'Available', location: 'Dubai Hills Estate', images: [
    'https://images.bayut.com/thumbnails/849298298-800x600.jpeg',
    'https://images.bayut.com/thumbnails/849298299-800x600.jpeg',
    'https://images.bayut.com/thumbnails/849298300-800x600.jpeg',
    'https://images.bayut.com/thumbnails/849298301-800x600.jpeg',
    'https://images.bayut.com/thumbnails/849298302-800x600.jpeg',
    'https://images.bayut.com/thumbnails/849298303-800x600.jpeg'
  ] } },
  { was: { projectName: 'Metro Business Park', unitNo: 'MBP-501' }, now: { projectName: 'Business Bay Corporate Tower', unitNo: '501', type: 'Office', areaSqft: 2000, bedrooms: null, bathrooms: 2, price: 5750000, status: 'Negotiation', location: 'Business Bay', images: [
    'https://images.bayut.com/thumbnails/836074933-800x600.jpeg',
    'https://images.bayut.com/thumbnails/836074934-800x600.jpeg',
    'https://images.bayut.com/thumbnails/836074935-800x600.jpeg',
    'https://images.bayut.com/thumbnails/836074936-800x600.jpeg',
    'https://images.bayut.com/thumbnails/836074937-800x600.jpeg'
  ] } },
  { was: { projectName: 'Sunrise Residency', unitNo: 'C-0302' }, now: { projectName: 'JVC Sunrise Residences', unitNo: '0302', type: '2BHK', areaSqft: 1055, bedrooms: 2, bathrooms: 3, price: 1350000, status: 'Sold', location: 'Jumeirah Village Circle (JVC)', images: [
    'https://images.bayut.com/thumbnails/861369580-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861369581-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861369582-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861369583-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861369584-800x600.jpeg',
    'https://images.bayut.com/thumbnails/861369585-800x600.jpeg'
  ] } }
];

// Brand-new "surrounding areas" listings that didn't exist before — inserted
// only if a property with that name isn't already there.
const NEW_LISTINGS = [
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
    let result = await db.pool.query(
      `UPDATE re_inventory SET project_name=$1, unit_no=$2, type=$3, area_sqft=$4, price=$5, status=$6, location=$7, images=$8, bedrooms=$9, bathrooms=$10
       WHERE account_id=$11 AND project_name=$12 AND unit_no=$13`,
      [r.now.projectName, r.now.unitNo, r.now.type, r.now.areaSqft, r.now.price, r.now.status, r.now.location, r.now.images, r.now.bedrooms, r.now.bathrooms,
        accountId, r.was.projectName, r.was.unitNo]
    );
    if (!result.rowCount) {
      // Already relocated in an earlier run (old project_name/unit_no won't
      // match anymore) — re-apply against the new name instead, so re-running
      // this script after adding a new field (like bedrooms/bathrooms) still
      // fills it in on rows that were already moved.
      result = await db.pool.query(
        `UPDATE re_inventory SET type=$1, area_sqft=$2, price=$3, status=$4, location=$5, images=$6, bedrooms=$7, bathrooms=$8
         WHERE account_id=$9 AND project_name=$10 AND unit_no=$11`,
        [r.now.type, r.now.areaSqft, r.now.price, r.now.status, r.now.location, r.now.images, r.now.bedrooms, r.now.bathrooms,
          accountId, r.now.projectName, r.now.unitNo]
      );
    }
    if (result.rowCount) { updated += result.rowCount; console.log('  Relocated:', r.was.projectName, r.was.unitNo, '->', r.now.projectName, r.now.location); }
    else console.log('  Skipped (not found under old or new name):', r.was.projectName, r.was.unitNo);
  }

  let inserted = 0;
  for (const n of NEW_LISTINGS) {
    const { rows } = await db.pool.query('SELECT id FROM re_inventory WHERE account_id=$1 AND project_name=$2', [accountId, n.projectName]);
    if (rows.length) {
      await db.pool.query(
        'UPDATE re_inventory SET type=$1, area_sqft=$2, price=$3, status=$4, location=$5, images=$6, bedrooms=$7, bathrooms=$8 WHERE id=$9',
        [n.type, n.areaSqft, n.price, n.status, n.location, n.images, n.bedrooms, n.bathrooms, rows[0].id]
      );
      console.log('  Already exists, refreshed:', n.projectName);
      continue;
    }
    await db.pool.query(
      `INSERT INTO re_inventory (id, account_id, project_name, unit_no, type, area_sqft, price, status, location, images, bedrooms, bathrooms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [db.id('re_prop'), accountId, n.projectName, n.unitNo, n.type, n.areaSqft, n.price, n.status, n.location, n.images, n.bedrooms, n.bathrooms]
    );
    inserted++;
    console.log('  Added:', n.projectName, n.location);
  }

  console.log(`Done. ${updated} relocated, ${inserted} added.`);
  await db.pool.end();
}

run().catch((err) => { console.error(err); process.exit(1); });
