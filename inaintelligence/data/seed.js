'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env — copy .env.example to .env and paste your Neon connection string in.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function id(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}
function hash(pw) {
  return bcrypt.hashSync(pw, 8);
}

async function seed() {
  console.log('Creating tables (if they do not exist yet)...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  const { rows } = await pool.query('SELECT count(*) FROM super_admins');
  if (Number(rows[0].count) > 0) {
    console.log('Super admin already exists — tables are ready, nothing to seed.');
    await pool.end();
    return;
  }

  // Only one login exists out of the box: you, the super admin. Every
  // Sales CRM (or later, ERP) account and its users gets created from the
  // super admin console itself — "+ New account" on /super-admin.html.
  await pool.query(
    'INSERT INTO super_admins (id, username, password_hash, name) VALUES ($1,$2,$3,$4)',
    [id('sa'), 'inatron@kinesys.net', hash('#@llanIna07'), 'Inacio Fernandes']
  );

  console.log('Seed complete.');
  console.log('  Super admin -> inatron@kinesys.net (password set — check your notes, not printed here)');
  console.log('  Log in, then use "+ New account" to create your first Sales CRM and its admin.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
