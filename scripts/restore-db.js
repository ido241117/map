const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DUMP_PATH = path.join(__dirname, '..', 'data', 'hcm_land_mvp.sql');
const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

function runPsql(database, sqlFile) {
  return spawnSync(
    'psql',
    ['-U', PGUSER, '-h', PGHOST, '-p', String(PGPORT), '-d', database, '-f', sqlFile],
    {
      env: { ...process.env, PGPASSWORD },
      stdio: 'inherit',
    },
  );
}

function ensureDatabase() {
  return runPsql('postgres', path.join(__dirname, 'setup-db.sql'));
}

function main() {
  if (!fs.existsSync(DUMP_PATH)) {
    console.error(`Không tìm thấy dump: ${DUMP_PATH}`);
    console.error('Chạy npm run db:export để tạo lại từ PostgreSQL.');
    process.exit(1);
  }

  const setup = ensureDatabase();
  if (setup.status !== 0) {
    process.exit(setup.status ?? 1);
  }

  console.log(`Restore ${DUMP_PATH} → ${DB_NAME}...`);
  const result = runPsql(DB_NAME, DUMP_PATH);
  process.exit(result.status ?? 1);
}

main();
