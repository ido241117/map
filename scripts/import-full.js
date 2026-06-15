const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const SQL_PATH = path.join(__dirname, 'import-full.sql');
const CSV_PATH = path.join(__dirname, '..', 'scan', 'crawler', 'data', 'hcm_land_data.csv');
const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';
const FORCE = process.env.FORCE === '1' || process.argv.includes('--force');

async function getRowCount() {
  const client = new Client({
    host: PGHOST,
    port: PGPORT,
    user: PGUSER,
    password: PGPASSWORD,
    database: DB_NAME,
  });

  try {
    await client.connect();
    const exists = await client.query(
      "SELECT to_regclass('public.land_parcels') IS NOT NULL AS exists",
    );
    if (!exists.rows[0].exists) {
      return 0;
    }

    const result = await client.query('SELECT COUNT(*)::int AS count FROM land_parcels');
    return result.rows[0].count;
  } catch (error) {
    if (error.code === '3D000') {
      return 0;
    }
    throw error;
  } finally {
    await client.end();
  }
}

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

async function ensureDatabase() {
  const setup = runPsql('postgres', path.join(__dirname, 'setup-db.sql'));

  if (setup.status !== 0) {
    process.exit(setup.status ?? 1);
  }
}

async function main() {
  await ensureDatabase();

  const existingRows = await getRowCount();
  if (existingRows > 0 && !FORCE) {
    console.log(`Giữ nguyên DB: land_parcels đã có ${existingRows.toLocaleString('vi-VN')} dòng.`);
    console.log('Chỉ import lại khi thật sự cần: npm run db:import:force');
    process.exit(0);
  }

  if (existingRows > 0 && FORCE) {
    console.warn(`FORCE=1: ghi đè ${existingRows.toLocaleString('vi-VN')} dòng hiện có từ CSV...`);
  } else {
    console.log('DB trống, bắt đầu import full CSV (~300k dòng)...');
  }

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Không tìm thấy CSV: ${CSV_PATH}`);
    console.error('Chạy npm run db:export hoặc npm run db:restore để có dữ liệu.');
    process.exit(1);
  }

  const tempSqlPath = path.join(__dirname, '.import-full.tmp.sql');
  const sql = fs.readFileSync(SQL_PATH, 'utf8').replace(
    '__CSV_PATH__',
    CSV_PATH.replace(/\\/g, '/'),
  );
  fs.writeFileSync(tempSqlPath, sql);

  const result = runPsql(DB_NAME, tempSqlPath);
  fs.rmSync(tempSqlPath, { force: true });

  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
