const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const SQL_PATH = path.join(__dirname, 'import-guland-hcm-land-append.sql');
const CSV_PATH =
  process.env.GULAND_CSV_PATH ||
  'C:\\Users\\ADMIN\\Downloads\\guland_hcm_land.csv';
const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

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
      "SELECT to_regclass('public.guland_hcm_land') IS NOT NULL AS exists",
    );
    if (!exists.rows[0].exists) {
      return 0;
    }

    const result = await client.query('SELECT COUNT(*)::int AS count FROM guland_hcm_land');
    return result.rows[0].count;
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

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Không tìm thấy file CSV: ${CSV_PATH}`);
    process.exit(1);
  }

  const existingRows = await getRowCount();
  if (existingRows === 0) {
    console.log('guland_hcm_land trống — dùng npm run db:import:guland thay vì append.');
    process.exit(1);
  }

  console.log(`guland_hcm_land hiện có: ${existingRows.toLocaleString('vi-VN')} dòng`);
  console.log(`Append từ CSV: ${CSV_PATH}`);

  const tempSqlPath = path.join(__dirname, '.import-guland-hcm-land-append.tmp.sql');
  const sql = fs.readFileSync(SQL_PATH, 'utf8').replace(
    '__CSV_PATH__',
    CSV_PATH.replace(/\\/g, '/'),
  );
  fs.writeFileSync(tempSqlPath, sql);

  const result = runPsql(DB_NAME, tempSqlPath);
  fs.rmSync(tempSqlPath, { force: true });

  if (result.status === 0) {
    const newTotal = await getRowCount();
    const added = newTotal - existingRows;
    console.log(
      `Đã thêm ${added.toLocaleString('vi-VN')} dòng, cập nhật các parcel_id trùng. Tổng: ${newTotal.toLocaleString('vi-VN')}`,
    );
  }

  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
