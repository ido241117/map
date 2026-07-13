const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const SQL_PATH = path.join(__dirname, 'dedupe-land-parcels.sql');
const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

async function getCounts() {
  const client = new Client({
    host: PGHOST,
    port: PGPORT,
    user: PGUSER,
    password: PGPASSWORD,
    database: DB_NAME,
  });

  try {
    await client.connect();
    const { rows } = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(DISTINCT shape_file_id)::int AS unique_ids,
        (
          SELECT COALESCE(SUM(cnt - 1), 0)::int
          FROM (
            SELECT COUNT(*) AS cnt
            FROM land_parcels
            WHERE geometry_json IS NOT NULL
              AND geometry_json->>'type' = 'MultiPolygon'
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
            GROUP BY
              ROUND(latitude::numeric, 6),
              ROUND(longitude::numeric, 6),
              md5(geometry_json::text)
            HAVING COUNT(*) > 1
          ) d
        ) AS geom_dup_rows
      FROM land_parcels
    `);
    return rows[0];
  } finally {
    await client.end();
  }
}

function runPsql() {
  return spawnSync(
    'psql',
    ['-U', PGUSER, '-h', PGHOST, '-p', String(PGPORT), '-d', DB_NAME, '-f', SQL_PATH],
    {
      env: { ...process.env, PGPASSWORD },
      stdio: 'inherit',
    },
  );
}

async function main() {
  const before = await getCounts();
  console.log(
    `Trước dedupe: ${before.total.toLocaleString('vi-VN')} dòng, ${before.unique_ids.toLocaleString('vi-VN')} unique shape_file_id, ${before.geom_dup_rows.toLocaleString('vi-VN')} trùng lat/lng+geometry`,
  );
  console.log(`Chạy ${SQL_PATH}...`);

  const result = runPsql();
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const after = await getCounts();
  const removed = before.total - after.total;
  console.log(
    `Sau dedupe: ${after.total.toLocaleString('vi-VN')} dòng (xóa ${removed.toLocaleString('vi-VN')})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
