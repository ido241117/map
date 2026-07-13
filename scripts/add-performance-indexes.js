const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SQL_PATH = path.join(__dirname, 'add-performance-indexes.sql');
const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

function main() {
  console.log(`Chạy ${SQL_PATH}...`);
  const result = spawnSync(
    'psql',
    ['-U', PGUSER, '-h', PGHOST, '-p', String(PGPORT), '-d', DB_NAME, '-f', SQL_PATH],
    {
      env: { ...process.env, PGPASSWORD },
      stdio: 'inherit',
    },
  );
  process.exit(result.status ?? 1);
}

main();
