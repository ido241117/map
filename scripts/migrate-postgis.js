const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const SQL_PATH = path.join(__dirname, 'migrate-postgis.sql');
const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

const HCM_PROVINCE_CODE = '79';
const LAND_PARCELS_SCOPE = process.env.LAND_PARCELS_SCOPE || 'hcm';
const LAND_PARCELS_WHERE =
  LAND_PARCELS_SCOPE === 'all'
    ? 'TRUE'
    : `province_code = '${HCM_PROVINCE_CODE}'`;
const BATCH_SIZE = Number(process.env.MIGRATE_BATCH_SIZE || 5000);

function pgClient() {
  return new Client({
    host: PGHOST,
    port: PGPORT,
    user: PGUSER,
    password: PGPASSWORD,
    database: DB_NAME,
  });
}

function runPsqlFile(filePath) {
  const result = spawnSync(
    'psql',
    ['-U', PGUSER, '-h', PGHOST, '-p', String(PGPORT), '-d', DB_NAME, '-f', filePath],
    {
      env: { ...process.env, PGPASSWORD },
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function ensurePostgis(client) {
  const { rows } = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') AS available",
  );
  if (!rows[0].available) {
    console.error('');
    console.error('PostGIS chưa được cài trên PostgreSQL local.');
    console.error(`  Host: ${PGHOST}:${PGPORT}  DB: ${DB_NAME}`);
    console.error('');
    console.error('Cần cài PostGIS cho PostgreSQL 17 trên Windows trước khi chạy Phase 1.1:');
    console.error('  1. Tải PostGIS bundle cho PG17: https://postgis.net/windows_downloads/');
    console.error('  2. Hoặc mở Stack Builder (cài cùng PostgreSQL) → chọn PostGIS');
    console.error('  3. Sau khi cài, chạy lại: npm run db:migrate-postgis');
    console.error('');
    console.error('Tôi không tự tải/cài PostGIS giúp bạn được — cần bạn cài một lần trên máy.');
    process.exit(1);
  }

  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
  } catch (error) {
    if (error.message.includes('is not available')) {
      console.error('');
      console.error('Extension postgis có trong catalog nhưng chưa cài đủ file trên máy.');
      console.error('Hãy cài PostGIS cho PostgreSQL 17 rồi chạy lại: npm run db:migrate-postgis');
      process.exit(1);
    }
    throw error;
  }

  const version = await client.query('SELECT postgis_version() AS v');
  console.log(`PostGIS: ${version.rows[0].v}`);
}

async function addGeomColumns(client) {
  await client.query(`
    ALTER TABLE land_parcels
      ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326)
  `);
  await client.query(`
    ALTER TABLE hcm_qhsdd
      ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326)
  `);
}

const GEO_FROM_JSON = `
  ST_SetSRID(
    ST_Multi(ST_MakeValid(ST_GeomFromGeoJSON(geometry_json::text))),
    4326
  )
`;

async function batchPopulateGeom(client, table, whereClause, label) {
  const pending = await client.query(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE geom IS NULL AND (${whereClause})`,
  );
  const total = pending.rows[0].count;
  if (total === 0) {
    console.log(`${label}: geom đã đủ, bỏ qua populate.`);
    return { total: 0, updated: 0, failed: 0 };
  }

  console.log(`${label}: populate geom cho ${total.toLocaleString('vi-VN')} dòng...`);
  let updated = 0;
  let failed = 0;
  const started = Date.now();

  while (true) {
    const result = await client.query(
      `
      WITH picked AS (
        SELECT id
        FROM ${table}
        WHERE geom IS NULL AND (${whereClause})
        ORDER BY id
        LIMIT $1
      )
      UPDATE ${table} t
      SET geom = ${GEO_FROM_JSON}
      FROM picked p
      WHERE t.id = p.id
        AND t.geometry_json IS NOT NULL
        AND jsonb_typeof(t.geometry_json) = 'object'
      `,
      [BATCH_SIZE],
    );

    if (result.rowCount === 0) {
      break;
    }
    updated += result.rowCount;
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    process.stdout.write(
      `\r  ${updated.toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')} (${elapsed}s)`,
    );
  }

  const invalid = await client.query(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE geom IS NULL AND (${whereClause})`,
  );
  failed = invalid.rows[0].count;
  console.log('');
  if (failed > 0) {
    console.log(`  Cảnh báo: ${failed.toLocaleString('vi-VN')} dòng chưa populate được geom.`);
  }
  return { total, updated, failed };
}

async function ensureCentroidColumn(client, table) {
  const exists = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = 'centroid'
    ) AS exists
    `,
    [table],
  );
  if (exists.rows[0].exists) {
    return;
  }

  await client.query(`
    ALTER TABLE ${table}
      ADD COLUMN centroid geometry(Point, 4326)
      GENERATED ALWAYS AS (ST_Centroid(geom)) STORED
  `);
  console.log(`${table}: đã thêm cột centroid (generated).`);
}

async function ensureGistIndex(client, table, indexName, whereClause) {
  const exists = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${indexName}`],
  );
  if (exists.rows[0].exists) {
    console.log(`Index ${indexName} đã tồn tại.`);
    return;
  }

  console.log(`Tạo GIST index ${indexName} (CONCURRENTLY, có thể mất vài phút)...`);

  const sql = `
    CREATE INDEX CONCURRENTLY ${indexName}
      ON ${table} USING GIST (geom)
      WHERE ${whereClause}
  `;
  const result = spawnSync(
    'psql',
    ['-U', PGUSER, '-h', PGHOST, '-p', String(PGPORT), '-d', DB_NAME, '-c', sql],
    {
      env: { ...process.env, PGPASSWORD },
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function printSummary(client) {
  const land = await client.query(`
    SELECT
      COUNT(*)::int AS total_hcm,
      COUNT(*) FILTER (WHERE geom IS NOT NULL)::int AS with_geom,
      COUNT(*) FILTER (WHERE geom IS NULL)::int AS missing_geom
    FROM land_parcels
    ${LAND_PARCELS_SCOPE === 'all' ? '' : 'WHERE province_code = $1'}
  `, LAND_PARCELS_SCOPE === 'all' ? [] : [HCM_PROVINCE_CODE]);

  const qhsdd = await client.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE geom IS NOT NULL)::int AS with_geom,
      COUNT(*) FILTER (WHERE geom IS NULL)::int AS missing_geom
    FROM hcm_qhsdd
  `);

  console.log('');
  console.log('=== Tóm tắt Phase 1.1 ===');
  console.log(
    `land_parcels: ${land.rows[0].with_geom.toLocaleString('vi-VN')} / ${land.rows[0].total_hcm.toLocaleString('vi-VN')} có geom` +
      (land.rows[0].missing_geom ? ` (${land.rows[0].missing_geom} thiếu)` : ''),
  );
  console.log(
    `hcm_qhsdd: ${qhsdd.rows[0].with_geom.toLocaleString('vi-VN')} / ${qhsdd.rows[0].total.toLocaleString('vi-VN')} có geom` +
      (qhsdd.rows[0].missing_geom ? ` (${qhsdd.rows[0].missing_geom} thiếu)` : ''),
  );
}

async function main() {
  const client = pgClient();
  await client.connect();

  try {
    console.log(`Database: ${DB_NAME} @ ${PGHOST}:${PGPORT}`);
    await ensurePostgis(client);
    await addGeomColumns(client);

    await batchPopulateGeom(
      client,
      'land_parcels',
      LAND_PARCELS_WHERE,
      `land_parcels (${LAND_PARCELS_SCOPE})`,
    );

    await batchPopulateGeom(
      client,
      'hcm_qhsdd',
      'TRUE',
      'hcm_qhsdd',
    );

    await ensureCentroidColumn(client, 'land_parcels');
    await ensureCentroidColumn(client, 'hcm_qhsdd');

    await ensureGistIndex(
      client,
      'land_parcels',
      'land_parcels_geom_gist',
      `${LAND_PARCELS_WHERE === 'TRUE' ? 'geom IS NOT NULL' : `${LAND_PARCELS_WHERE} AND geom IS NOT NULL`}`,
    );

    await ensureGistIndex(
      client,
      'hcm_qhsdd',
      'hcm_qhsdd_geom_gist',
      'geom IS NOT NULL',
    );
    await printSummary(client);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
