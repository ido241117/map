const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DUMP_PATH = path.join(DATA_DIR, 'hcm_land_mvp.sql');
const CSV_PATH = path.join(__dirname, '..', 'scan', 'crawler', 'data', 'hcm_land_data.csv');
const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    env: { ...process.env, PGPASSWORD },
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });

  console.log(`Dump SQL → ${DUMP_PATH}`);
  run('pg_dump', [
    '-U',
    PGUSER,
    '-h',
    PGHOST,
    '-p',
    String(PGPORT),
    '-d',
    DB_NAME,
    '--no-owner',
    '--no-acl',
    '--clean',
    '--if-exists',
    '-f',
    DUMP_PATH,
  ]);

  console.log(`Export CSV → ${CSV_PATH}`);
  run('psql', [
    '-U',
    PGUSER,
    '-h',
    PGHOST,
    '-p',
    String(PGPORT),
    '-d',
    DB_NAME,
    '-c',
    `\\copy (SELECT shape_file_id::text, property_code, address, latitude::text, longitude::text, total_area::text, planning_land_type, province, province_code, district, district_code, ward, ward_code, property_uuid, geometry_json::text AS geometry_json FROM land_parcels ORDER BY id) TO '${CSV_PATH.replace(/\\/g, '/')}' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')`,
  ]);

  console.log('Export xong.');
}

main();
