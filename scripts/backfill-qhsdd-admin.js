/**
 * Gán district/ward cho hcm_qhsdd từ land_parcels:
 * 1) ST_Contains(centroid)
 * 2) nearest parcel ≤ 500m (KNN)
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const SQL_PATH = path.join(__dirname, 'backfill-qhsdd-admin.sql');
const DB_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/hcm_land_mvp';
const NEAREST_MAX_M = Number(process.env.QHSDD_NEAREST_MAX_M || 500);

function runPsqlFile() {
  const url = new URL(DB_URL);
  const result = spawnSync(
    'psql',
    [
      '-U',
      url.username,
      '-h',
      url.hostname,
      '-p',
      url.port || '5432',
      '-d',
      url.pathname.replace(/^\//, ''),
      '-f',
      SQL_PATH,
    ],
    {
      env: { ...process.env, PGPASSWORD: url.password },
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function countByMatch(client) {
  const { rows } = await client.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE district IS NOT NULL)::int AS with_district,
      COUNT(*) FILTER (WHERE admin_match = 'contains')::int AS contains_match,
      COUNT(*) FILTER (WHERE admin_match = 'nearest')::int AS nearest_match,
      COUNT(*) FILTER (WHERE district IS NULL)::int AS unmatched
    FROM hcm_qhsdd
  `);
  return rows[0];
}

async function backfillContains(client) {
  console.log('Bước 1/2: ST_Contains(centroid → thửa)...');
  const started = Date.now();
  const { rowCount } = await client.query(`
    UPDATE hcm_qhsdd q
    SET
      district = m.district,
      ward = m.ward,
      admin_match = 'contains'
    FROM (
      SELECT
        q2.id,
        lp.district,
        lp.ward
      FROM hcm_qhsdd q2
      JOIN LATERAL (
        SELECT district, ward
        FROM land_parcels lp
        WHERE lp.province_code = '79'
          AND lp.geom IS NOT NULL
          AND lp.district IS NOT NULL
          AND ST_Contains(lp.geom, q2.centroid)
        LIMIT 1
      ) lp ON true
      WHERE q2.district IS NULL
    ) m
    WHERE q.id = m.id
  `);
  console.log(`  → ${rowCount ?? 0} zone (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

async function backfillNearest(client) {
  console.log(`Bước 2/2: nearest parcel ≤ ${NEAREST_MAX_M}m...`);
  const started = Date.now();
  const { rowCount } = await client.query(
    `
    UPDATE hcm_qhsdd q
    SET
      district = m.district,
      ward = m.ward,
      admin_match = 'nearest'
    FROM (
      SELECT
        q2.id,
        lp.district,
        lp.ward
      FROM hcm_qhsdd q2
      JOIN LATERAL (
        SELECT district, ward, geom
        FROM land_parcels lp
        WHERE lp.province_code = '79'
          AND lp.geom IS NOT NULL
          AND lp.district IS NOT NULL
        ORDER BY lp.geom <-> q2.centroid
        LIMIT 1
      ) lp ON true
      WHERE q2.district IS NULL
        AND ST_Distance(q2.centroid::geography, lp.geom::geography) <= $1
    ) m
    WHERE q.id = m.id
    `,
    [NEAREST_MAX_M],
  );
  console.log(`  → ${rowCount ?? 0} zone (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

async function main() {
  console.log('DB:', DB_URL.replace(/:[^:@]+@/, ':***@'));
  runPsqlFile();

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  const before = await countByMatch(client);
  console.log(`Trước: ${before.with_district}/${before.total} có district`);

  await backfillContains(client);
  await backfillNearest(client);

  const after = await countByMatch(client);
  console.log('');
  console.log('Kết quả:');
  console.log(`  Tổng zone:      ${after.total}`);
  console.log(`  Có district:    ${after.with_district} (${((100 * after.with_district) / after.total).toFixed(1)}%)`);
  console.log(`  contains:       ${after.contains_match}`);
  console.log(`  nearest:        ${after.nearest_match}`);
  console.log(`  chưa gán:       ${after.unmatched}`);

  if (after.unmatched > 0) {
    const { rows } = await client.query(`
      SELECT id, feature_id, loai_dat_quy_hoach, center_lat, center_long
      FROM hcm_qhsdd
      WHERE district IS NULL
      ORDER BY id
      LIMIT 10
    `);
    console.log('');
    console.log('Mẫu zone chưa gán (tối đa 10):');
    for (const row of rows) {
      console.log(`  #${row.id} ${row.loai_dat_quy_hoach} @ ${row.center_lat}, ${row.center_long}`);
    }
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
