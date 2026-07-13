const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'setup-auth.sql'), 'utf8');
  const client = new Client({
    host: PGHOST,
    port: PGPORT,
    user: PGUSER,
    password: PGPASSWORD,
    database: DB_NAME,
  });

  await client.connect();
  await client.query(sql);
  await client.end();
  console.log('Auth tables ready.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
