const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.postgis.yml');
const SCHEMA_SQL = path.join(__dirname, 'docker-hcm-pilot-schema.sql');
const INDEXES_SQL = path.join(__dirname, 'docker-hcm-pilot-indexes.sql');
const MIGRATE_JS = path.join(__dirname, 'migrate-postgis.js');

const SRC = {
  host: process.env.SRC_PGHOST || 'localhost',
  port: Number(process.env.SRC_PGPORT || 5432),
  user: process.env.SRC_PGUSER || 'postgres',
  password: process.env.SRC_PGPASSWORD || 'postgres',
  database: process.env.SRC_PGDATABASE || 'hcm_land_mvp',
};

const DEST = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'hcm_land_mvp',
};

const HCM_PROVINCE_CODE = '79';
const BATCH_SIZE = Number(process.env.SYNC_BATCH_SIZE || 2000);
const RESET = process.argv.includes('--reset');
const SKIP_MIGRATE = process.argv.includes('--skip-migrate');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    ...opts,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runPsql(target, sqlPath) {
  run('psql', [
    '-U', target.user,
    '-h', target.host,
    '-p', String(target.port),
    '-d', target.database,
    '-f', sqlPath,
  ], {
    env: { ...process.env, PGPASSWORD: target.password },
  });
}

async function waitForPostgres(target, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const client = new Client(target);
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`PostgreSQL chưa sẵn sàng sau ${timeoutMs / 1000}s (${target.host}:${target.port})`);
}

function removeLegacyContainer() {
  console.log('Gỡ container OSM cũ (nếu có): osm_hcm_postgis');
  spawnSync('docker', ['rm', '-f', 'osm_hcm_postgis'], { stdio: 'inherit' });
}

function startDocker(reset) {
  if (reset) {
    console.log('Reset volume Docker (hcm_land_pg_data)...');
    run('docker', ['compose', '-f', COMPOSE_FILE, 'down', '-v']);
  } else {
    run('docker', ['compose', '-f', COMPOSE_FILE, 'down']);
  }
  console.log('Khởi động hcm_land_postgis...');
  run('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d']);
}

async function countSourceRows(src) {
  const parcels = await src.query(
    `
    SELECT COUNT(*)::int AS count
    FROM land_parcels
    WHERE province_code = $1 AND geometry_json IS NOT NULL
    `,
    [HCM_PROVINCE_CODE],
  );
  const qhsdd = await src.query('SELECT COUNT(*)::int AS count FROM hcm_qhsdd');
  return {
    parcels: parcels.rows[0].count,
    qhsdd: qhsdd.rows[0].count,
  };
}

async function copyLandParcels(src, dest) {
  const total = (
    await src.query(
      `
      SELECT COUNT(*)::int AS count
      FROM land_parcels
      WHERE province_code = $1 AND geometry_json IS NOT NULL
      `,
      [HCM_PROVINCE_CODE],
    )
  ).rows[0].count;

  console.log(`Sync land_parcels (province_code=${HCM_PROVINCE_CODE}): ${total.toLocaleString('vi-VN')} dòng...`);
  let lastId = 0;
  let copied = 0;
  const started = Date.now();

  while (true) {
    const { rows } = await src.query(
      `
      SELECT
        id, shape_file_id, property_code, address,
        latitude, longitude, total_area, planning_land_type,
        province, province_code, district, district_code,
        ward, ward_code, property_uuid, geometry_json, imported_at
      FROM land_parcels
      WHERE province_code = $1
        AND id > $2
        AND geometry_json IS NOT NULL
      ORDER BY id
      LIMIT $3
      `,
      [HCM_PROVINCE_CODE, lastId, BATCH_SIZE],
    );

    if (!rows.length) break;

    const values = [];
    const params = [];
    let i = 1;
    for (const row of rows) {
      values.push(
        `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`,
      );
      params.push(
        row.id,
        row.shape_file_id,
        row.property_code,
        row.address,
        row.latitude,
        row.longitude,
        row.total_area,
        row.planning_land_type,
        row.province,
        row.province_code,
        row.district,
        row.district_code,
        row.ward,
        row.ward_code,
        row.property_uuid,
        row.geometry_json,
        row.imported_at,
      );
    }

    await dest.query(
      `
      INSERT INTO land_parcels (
        id, shape_file_id, property_code, address,
        latitude, longitude, total_area, planning_land_type,
        province, province_code, district, district_code,
        ward, ward_code, property_uuid, geometry_json, imported_at
      ) VALUES ${values.join(',')}
      `,
      params,
    );

    lastId = rows[rows.length - 1].id;
    copied += rows.length;
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    process.stdout.write(
      `\r  land_parcels: ${copied.toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')} (${elapsed}s)`,
    );
  }

  console.log('');
  await dest.query(
    `SELECT setval(pg_get_serial_sequence('land_parcels', 'id'), COALESCE((SELECT MAX(id) FROM land_parcels), 1))`,
  );
}

async function copyQhsdd(src, dest) {
  const total = (await src.query('SELECT COUNT(*)::int AS count FROM hcm_qhsdd')).rows[0].count;
  console.log(`Sync hcm_qhsdd: ${total.toLocaleString('vi-VN')} dòng...`);
  let lastId = 0;
  let copied = 0;
  const started = Date.now();

  while (true) {
    const { rows } = await src.query(
      `
      SELECT
        id, feature_id, loai_dat_quy_hoach, center_lat, center_long,
        red, green, blue, color, fill_hex, geometry_type,
        geometry_json, imported_at
      FROM hcm_qhsdd
      WHERE id > $1
      ORDER BY id
      LIMIT $2
      `,
      [lastId, BATCH_SIZE],
    );

    if (!rows.length) break;

    const values = [];
    const params = [];
    let i = 1;
    for (const row of rows) {
      values.push(
        `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`,
      );
      params.push(
        row.id,
        row.feature_id,
        row.loai_dat_quy_hoach,
        row.center_lat,
        row.center_long,
        row.red,
        row.green,
        row.blue,
        row.color,
        row.fill_hex,
        row.geometry_type,
        row.geometry_json,
        row.imported_at,
      );
    }

    await dest.query(
      `
      INSERT INTO hcm_qhsdd (
        id, feature_id, loai_dat_quy_hoach, center_lat, center_long,
        red, green, blue, color, fill_hex, geometry_type,
        geometry_json, imported_at
      ) VALUES ${values.join(',')}
      `,
      params,
    );

    lastId = rows[rows.length - 1].id;
    copied += rows.length;
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    process.stdout.write(
      `\r  hcm_qhsdd: ${copied.toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')} (${elapsed}s)`,
    );
  }

  console.log('');
  await dest.query(
    `SELECT setval(pg_get_serial_sequence('hcm_qhsdd', 'id'), COALESCE((SELECT MAX(id) FROM hcm_qhsdd), 1))`,
  );
}

async function updateMeta(dest, counts) {
  await dest.query(
    `
    INSERT INTO db_meta (key, value, updated_at)
    VALUES
      ('land_parcels_row_count', $1, now()),
      ('hcm_qhsdd_row_count', $2, now())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `,
    [String(counts.parcels), String(counts.qhsdd)],
  );
}

function runPostgisMigration() {
  console.log('');
  console.log('Chạy Phase 1.1 PostGIS trên Docker...');
  run('node', [MIGRATE_JS], {
    env: {
      ...process.env,
      PGHOST: DEST.host,
      PGPORT: String(DEST.port),
      PGUSER: DEST.user,
      PGPASSWORD: DEST.password,
      PGDATABASE: DEST.database,
      LAND_PARCELS_SCOPE: 'all',
    },
  });
}

async function main() {
  console.log('=== Docker MVP: HCM land_parcels + hcm_qhsdd ===');
  console.log(`Source: ${SRC.host}:${SRC.port}/${SRC.database}`);
  console.log(`Dest:   ${DEST.host}:${DEST.port}/${DEST.database}`);
  if (RESET) console.log('Mode:   --reset (volume mới)');
  console.log('');

  const src = new Client(SRC);
  await src.connect();
  const counts = await countSourceRows(src);
  console.log(
    `Sẽ sync: ${counts.parcels.toLocaleString('vi-VN')} land_parcels + ${counts.qhsdd.toLocaleString('vi-VN')} hcm_qhsdd`,
  );
  console.log('');

  removeLegacyContainer();
  startDocker(RESET);
  await waitForPostgres(DEST);

  runPsql(DEST, SCHEMA_SQL);

  const dest = new Client(DEST);
  await dest.connect();
  try {
    await copyLandParcels(src, dest);
    await copyQhsdd(src, dest);
    await updateMeta(dest, counts);
  } finally {
    await dest.end();
    await src.end();
  }

  runPsql(DEST, INDEXES_SQL);

  if (!SKIP_MIGRATE) {
    runPostgisMigration();
  } else {
    console.log('Bỏ qua migrate-postgis (--skip-migrate).');
  }

  console.log('');
  console.log('=== Xong ===');
  console.log(`Docker PostGIS: postgres://postgres:postgres@${DEST.host}:${DEST.port}/${DEST.database}`);
  console.log('Đặt backend DATABASE_URL trỏ port 5433 để dùng DB này.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
