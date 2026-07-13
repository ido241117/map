const fs = require('node:fs');
const path = require('node:path');
const Papa = require('papaparse');
const { Client } = require('pg');

const CSV_PATH = path.join(
  __dirname,
  '..',
  'scan',
  'crawler',
  'data',
  'hcm_land_data.csv',
);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5432/hcm_land_mvp';

const AN_KHANH_IDS = new Set([
  2251724, 2251732, 2251736, 2252675, 2252695, 2252746, 2252886, 2252897,
  2252939, 2253064, 2253065, 2253070, 2253071, 2253072, 2253073,
]);

const CENTROID_THRESHOLD = 0.05;
const BATCH_SIZE = 500;

function geometryMatchesLatLng(geometryJson, lat, lng) {
  try {
    const geom = JSON.parse(geometryJson);
    const ring = geom?.coordinates?.[0]?.[0];
    if (!ring?.length) return false;
    const glng = ring[0][0];
    const glat = ring[0][1];
    return (
      Math.abs(glat - lat) <= CENTROID_THRESHOLD &&
      Math.abs(glng - lng) <= CENTROID_THRESHOLD
    );
  } catch {
    return false;
  }
}

function loadCsvFixes(targetIds) {
  return new Promise((resolve, reject) => {
    const fixes = new Map();
    const targetSet = targetIds ? new Set(targetIds) : null;

    Papa.parse(fs.createReadStream(CSV_PATH, { encoding: 'utf8' }), {
      header: true,
      skipEmptyLines: true,
      step(result) {
        const row = result.data;
        const shapeFileId = Number(row.shape_file_id);
        if (!Number.isFinite(shapeFileId)) return;
        if (targetSet && !targetSet.has(shapeFileId)) return;
        if (AN_KHANH_IDS.has(shapeFileId)) return;

        const lat = Number(row.latitude);
        const lng = Number(row.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        if (geometryMatchesLatLng(row.geometry_json, lat, lng)) {
          fixes.set(shapeFileId, row.geometry_json);
        }
      },
      complete() {
        resolve(fixes);
      },
      error: reject,
    });
  });
}

async function fetchSuspiciousIds(client) {
  const { rows } = await client.query(
    `
    SELECT shape_file_id
    FROM land_parcels
    WHERE geometry_json IS NOT NULL
      AND geometry_json->>'type' = 'MultiPolygon'
      AND (
        ABS((geometry_json->'coordinates'->0->0->0->>1)::double precision - latitude) > $1
        OR ABS((geometry_json->'coordinates'->0->0->0->>0)::double precision - longitude) > $1
      )
    `,
    [CENTROID_THRESHOLD],
  );

  return rows.map((row) => Number(row.shape_file_id));
}

async function applyBatch(client, updates) {
  if (!updates.length) return 0;

  const shapeFileIds = updates.map((item) => item.shapeFileId);
  const geometries = updates.map((item) => item.geometryJson);

  await client.query(
    `
    UPDATE land_parcels AS lp
    SET geometry_json = batch.geometry_json::jsonb
    FROM (
      SELECT *
      FROM UNNEST($1::bigint[], $2::text[]) AS t(shape_file_id, geometry_json)
    ) AS batch
    WHERE lp.shape_file_id = batch.shape_file_id
    `,
    [shapeFileIds, geometries],
  );

  return updates.length;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Không tìm thấy CSV: ${CSV_PATH}`);
  }

  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  console.log('Cho phép geometry_json NULL (map vẽ marker khi thiếu polygon)...');
  await pg.query(`
    ALTER TABLE land_parcels
    ALTER COLUMN geometry_json DROP NOT NULL
  `);

  const suspiciousIds = await fetchSuspiciousIds(pg);
  console.log(`Thửa nghi centroid lệch >5 km: ${suspiciousIds.length.toLocaleString('vi-VN')}`);

  console.log('Đọc geometry chuẩn từ CSV (chỉ các id nghi)...');
  const csvFixes = await loadCsvFixes(suspiciousIds);
  console.log(`CSV có geometry khớp lat/lng: ${csvFixes.size.toLocaleString('vi-VN')} id`);

  let updatedFromCsv = 0;
  let nulled = 0;

  const toUpdate = [];
  const toNull = new Set();

  for (const shapeFileId of suspiciousIds) {
    if (AN_KHANH_IDS.has(shapeFileId)) {
      toNull.add(shapeFileId);
      continue;
    }

    const geometryJson = csvFixes.get(shapeFileId);
    if (geometryJson) {
      toUpdate.push({ shapeFileId, geometryJson });
    } else {
      toNull.add(shapeFileId);
    }
  }

  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    updatedFromCsv += await applyBatch(pg, batch);
    process.stdout.write(`\rCập nhật từ CSV: ${updatedFromCsv.toLocaleString('vi-VN')}`);
  }
  if (toUpdate.length) process.stdout.write('\n');

  if (toNull.size) {
    const nullIds = [...toNull];
    for (let i = 0; i < nullIds.length; i += BATCH_SIZE) {
      const batch = nullIds.slice(i, i + BATCH_SIZE);
      await pg.query(
        `
        UPDATE land_parcels
        SET geometry_json = NULL
        WHERE shape_file_id = ANY($1::bigint[])
        `,
        [batch],
      );
      nulled += batch.length;
    }
  }

  const remaining = await fetchSuspiciousIds(pg);
  await pg.query(
    `
    INSERT INTO db_meta (key, value, updated_at)
    VALUES
      ('geometry_fix_at', now()::text, now()),
      ('geometry_fix_csv_updated', $1::text, now()),
      ('geometry_fix_nulled', $2::text, now()),
      ('geometry_fix_remaining_bad', $3::text, now())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at
    `,
    [String(updatedFromCsv), String(nulled), String(remaining.length)],
  );

  await pg.query('ANALYZE land_parcels');
  await pg.end();

  console.log(`  -> Cập nhật từ CSV: ${updatedFromCsv.toLocaleString('vi-VN')}`);
  console.log(`  -> NULL geometry: ${nulled.toLocaleString('vi-VN')}`);
  console.log(`  -> Còn nghi sau fix: ${remaining.length.toLocaleString('vi-VN')}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
