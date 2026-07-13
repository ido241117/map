const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SQL_PATH = path.join(__dirname, 'import-hcm-qhsdd.sql');
const CSV_PATH =
  process.env.QHSDD_CSV_PATH ||
  path.join(__dirname, '..', 'scan', 'crawler', 'data', 'hcm_qhsdd_data.csv');
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

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Không tìm thấy file CSV: ${CSV_PATH}`);
    process.exit(1);
  }

  const tempSqlPath = path.join(__dirname, '.import-hcm-qhsdd.tmp.sql');
  const sql = fs.readFileSync(SQL_PATH, 'utf8').replace(
    '__CSV_PATH__',
    CSV_PATH.replace(/\\/g, '/'),
  );
  fs.writeFileSync(tempSqlPath, sql);

  console.log(`Import từ: ${CSV_PATH}`);
  const result = runPsql(DB_NAME, tempSqlPath);

  fs.rmSync(tempSqlPath, { force: true });

  process.exit(result.status ?? 1);
}

main();
