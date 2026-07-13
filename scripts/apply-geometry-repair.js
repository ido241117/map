/**
 * Apply geometry fixes from repair_land_tile_geometry.py to PostgreSQL.
 *
 * Updates geometry_json + geom for existing land_parcels rows (by shape_file_id).
 * Does NOT insert new rows — use db:import:append for that.
 *
 * Usage:
 *   node scripts/apply-geometry-repair.js
 *   node scripts/apply-geometry-repair.js path/to/fixes.jsonl
 */
const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
const { Client } = require('pg');

const DEFAULT_FIXES = path.join(
  __dirname,
  '..',
  'scan',
  'crawler',
  'data',
  'hcm_land_geometry_repair_fixes.jsonl',
);
const FIXES_PATH = process.argv[2]
  ? path.isAbsolute(process.argv[2])
    ? process.argv[2]
    : path.join(process.cwd(), process.argv[2])
  : DEFAULT_FIXES;

const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';
const BATCH_SIZE = Number(process.env.APPLY_BATCH_SIZE || 500);

const GEO_FROM_JSON = `
  ST_SetSRID(
    ST_Multi(ST_MakeValid(ST_GeomFromGeoJSON(batch.geometry_json))),
    4326
  )
`;

async function ensureGeomColumn(client) {
  await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await client.query(`
    ALTER TABLE land_parcels
      ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326)
  `);
}

async function applyBatch(client, batch) {
  if (!batch.length) return 0;

  const shapeFileIds = batch.map((row) => row.shape_file_id);
  const geometries = batch.map((row) => row.geometry_json);

  const result = await client.query(
    `
    UPDATE land_parcels AS lp
    SET
      geometry_json = batch.geometry_json::jsonb,
      geom = ${GEO_FROM_JSON}
    FROM (
      SELECT *
      FROM UNNEST($1::bigint[], $2::text[]) AS t(shape_file_id, geometry_json)
    ) AS batch
    WHERE lp.shape_file_id = batch.shape_file_id
    `,
    [shapeFileIds, geometries],
  );

  return result.rowCount;
}

async function streamFixes(onBatch) {
  if (!fs.existsSync(FIXES_PATH)) {
    throw new Error(`Không tìm thấy fixes: ${FIXES_PATH}`);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(FIXES_PATH, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let batch = [];
  let lines = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lines += 1;

    const row = JSON.parse(trimmed);
    const shapeFileId = Number(row.shape_file_id);
    const geometryJson = row.geometry_json;
    if (!Number.isFinite(shapeFileId) || !geometryJson) continue;

    batch.push({ shape_file_id: shapeFileId, geometry_json: geometryJson });
    if (batch.length >= BATCH_SIZE) {
      await onBatch(batch, lines);
      batch = [];
    }
  }

  if (batch.length) {
    await onBatch(batch, lines);
  }

  return lines;
}

async function main() {
  console.log(`Fixes: ${FIXES_PATH}`);
  console.log(`Database: ${DB_NAME} @ ${PGHOST}:${PGPORT}`);

  const client = new Client({
    host: PGHOST,
    port: PGPORT,
    user: PGUSER,
    password: PGPASSWORD,
    database: DB_NAME,
  });

  await client.connect();
  await ensureGeomColumn(client);

  const before = await client.query(`
    SELECT COUNT(*)::int AS total
    FROM land_parcels
    WHERE province_code = '79'
  `);
  console.log(`land_parcels HCM: ${before.rows[0].total.toLocaleString('vi-VN')} dòng`);

  let updated = 0;
  let batches = 0;
  const started = Date.now();

  const lines = await streamFixes(async (batch, lineNo) => {
    const count = await applyBatch(client, batch);
    updated += count;
    batches += 1;
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    process.stdout.write(
      `\r  batch ${batches} | lines ${lineNo.toLocaleString('vi-VN')} | updated ${updated.toLocaleString('vi-VN')} (${elapsed}s)`,
    );
  });

  console.log('');
  console.log(`Fixes file: ${lines.toLocaleString('vi-VN')} dòng`);
  console.log(`Rows updated: ${updated.toLocaleString('vi-VN')}`);

  await client.query('ANALYZE land_parcels');

  await client.query(
    `
    INSERT INTO db_meta (key, value, updated_at)
    VALUES
      ('geometry_tile_repair_at', now()::text, now()),
      ('geometry_tile_repair_updated', $1::text, now())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at
    `,
    [String(updated)],
  );

  await client.end();
  console.log('Done. Hard-refresh map (Ctrl+Shift+R) to clear MVT cache.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
