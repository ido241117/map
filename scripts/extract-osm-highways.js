/**
 * Extract highways from full OSM PostGIS (port 5434 / map_osm_pg_data)
 * into slim DB (port 5435 / map_osm_highways_pg_data).
 *
 * Usage:
 *   npm run db:osm:up              # nguồn full (nếu chưa chạy)
 *   npm run db:osm:highways:up     # đích slim
 *   npm run db:osm:highways:extract
 *
 * --force  : xóa bảng osm_highways trên đích rồi restore lại
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const SOURCE_CONTAINER = 'osm_hcm_postgis';
const TARGET_CONTAINER = 'osm_highways_postgis';
const SOURCE_DB = 'osm_hcm';
const TARGET_DB = 'osm_highways';
const EXPORT_TABLE = 'osm_highways_export';
const FINAL_TABLE = 'osm_highways';
const DUMP_IN_CONTAINER = '/tmp/osm_highways.dump';

const force = process.argv.includes('--force');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: opts.stdio || 'pipe',
    ...opts,
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed (${result.status}): ${err}`);
  }
  return (result.stdout || '').trim();
}

function dockerExec(container, args, opts = {}) {
  return run('docker', ['exec', container, ...args], opts);
}

function dockerExecPg(container, db, sql) {
  return dockerExec(container, ['psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', sql]);
}

function inspectRunning(container) {
  try {
    return run('docker', ['inspect', '-f', '{{.State.Running}}', container]) === 'true';
  } catch {
    return false;
  }
}

function waitHealthy(container, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let health = 'n/a';
    try {
      health = run('docker', [
        'inspect',
        '-f',
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
        container,
      ]);
    } catch {
      health = 'missing';
    }
    if (health === 'healthy' || health === 'none') {
      try {
        dockerExec(container, ['pg_isready', '-U', 'postgres']);
        return;
      } catch {
        // keep waiting
      }
    }
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], {
      timeout: 5000,
      stdio: 'ignore',
    });
  }
  throw new Error(`Timeout chờ ${container} healthy`);
}

function main() {
  if (!inspectRunning(SOURCE_CONTAINER)) {
    console.error(`Nguồn ${SOURCE_CONTAINER} chưa chạy. Chạy: npm run db:osm:up`);
    process.exit(1);
  }
  if (!inspectRunning(TARGET_CONTAINER)) {
    console.error(`Đích ${TARGET_CONTAINER} chưa chạy. Chạy: npm run db:osm:highways:up`);
    process.exit(1);
  }

  console.log('Chờ Postgres healthy…');
  waitHealthy(SOURCE_CONTAINER);
  waitHealthy(TARGET_CONTAINER);

  const existing = dockerExec(TARGET_CONTAINER, [
    'psql',
    '-U',
    'postgres',
    '-d',
    TARGET_DB,
    '-tAc',
    `SELECT to_regclass('public.${FINAL_TABLE}') IS NOT NULL`,
  ]);
  if (existing === 't' && !force) {
    console.log(`Bảng ${FINAL_TABLE} đã có trên ${TARGET_DB}. Thêm --force để extract lại.`);
    const stats = dockerExecPg(
      TARGET_CONTAINER,
      TARGET_DB,
      `SELECT COUNT(*) AS rows, pg_size_pretty(pg_total_relation_size('${FINAL_TABLE}')) AS size FROM ${FINAL_TABLE};`,
    );
    console.log(stats);
    return;
  }

  console.log(`1/5 Tạo bảng tạm ${EXPORT_TABLE} trên nguồn (highway IS NOT NULL)…`);
  dockerExecPg(
    SOURCE_CONTAINER,
    SOURCE_DB,
    `
    DROP TABLE IF EXISTS ${EXPORT_TABLE};
    CREATE TABLE ${EXPORT_TABLE} AS
    SELECT
      osm_id,
      name,
      highway,
      ref,
      z_order,
      oneway,
      bridge,
      tunnel,
      layer,
      service,
      surface,
      way
    FROM planet_osm_line
    WHERE highway IS NOT NULL;
    CREATE INDEX ${EXPORT_TABLE}_way_idx ON ${EXPORT_TABLE} USING GIST (way);
    CREATE INDEX ${EXPORT_TABLE}_osm_id_idx ON ${EXPORT_TABLE} (osm_id);
    CREATE INDEX ${EXPORT_TABLE}_highway_idx ON ${EXPORT_TABLE} (highway);
    ANALYZE ${EXPORT_TABLE};
    `,
  );

  console.log('2/5 pg_dump → file trong container nguồn…');
  dockerExec(SOURCE_CONTAINER, [
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    SOURCE_DB,
    '-Fc',
    '-t',
    EXPORT_TABLE,
    '-f',
    DUMP_IN_CONTAINER,
  ]);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-highways-'));
  const localDump = path.join(tmpDir, 'osm_highways.dump');
  try {
    console.log('3/5 docker cp dump sang đích…');
    run('docker', ['cp', `${SOURCE_CONTAINER}:${DUMP_IN_CONTAINER}`, localDump]);
    run('docker', ['cp', localDump, `${TARGET_CONTAINER}:${DUMP_IN_CONTAINER}`]);

    console.log('4/5 CREATE EXTENSION + pg_restore trên đích…');
    dockerExecPg(TARGET_CONTAINER, TARGET_DB, 'CREATE EXTENSION IF NOT EXISTS postgis;');
    dockerExecPg(
      TARGET_CONTAINER,
      TARGET_DB,
      `DROP TABLE IF EXISTS ${FINAL_TABLE}; DROP TABLE IF EXISTS ${EXPORT_TABLE};`,
    );
    dockerExec(TARGET_CONTAINER, [
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      TARGET_DB,
      '--no-owner',
      '--no-acl',
      DUMP_IN_CONTAINER,
    ]);
    dockerExecPg(
      TARGET_CONTAINER,
      TARGET_DB,
      `ALTER TABLE ${EXPORT_TABLE} RENAME TO ${FINAL_TABLE};
       ALTER INDEX IF EXISTS ${EXPORT_TABLE}_way_idx RENAME TO ${FINAL_TABLE}_way_idx;
       ALTER INDEX IF EXISTS ${EXPORT_TABLE}_osm_id_idx RENAME TO ${FINAL_TABLE}_osm_id_idx;
       ALTER INDEX IF EXISTS ${EXPORT_TABLE}_highway_idx RENAME TO ${FINAL_TABLE}_highway_idx;
       ANALYZE ${FINAL_TABLE};`,
    );

    console.log('5/5 Dọn bảng/file tạm trên nguồn…');
    dockerExecPg(SOURCE_CONTAINER, SOURCE_DB, `DROP TABLE IF EXISTS ${EXPORT_TABLE};`);
    dockerExec(SOURCE_CONTAINER, ['rm', '-f', DUMP_IN_CONTAINER]);
    dockerExec(TARGET_CONTAINER, ['rm', '-f', DUMP_IN_CONTAINER]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const verify = dockerExecPg(
    TARGET_CONTAINER,
    TARGET_DB,
    `
    SELECT
      COUNT(*) AS rows,
      COUNT(DISTINCT highway) AS highway_types,
      pg_size_pretty(pg_total_relation_size('${FINAL_TABLE}')) AS table_size,
      pg_size_pretty(pg_database_size('${TARGET_DB}')) AS db_size,
      Find_SRID('public','${FINAL_TABLE}','way') AS srid
    FROM ${FINAL_TABLE};
    SELECT highway, COUNT(*) AS n
    FROM ${FINAL_TABLE}
    GROUP BY highway
    ORDER BY n DESC
    LIMIT 10;
    `,
  );
  console.log(verify);
  console.log('\nXong. App sẽ dùng: postgres://postgres:postgres@localhost:5435/osm_highways');
  console.log('Nguồn full (5434) có thể tắt: npm run db:osm:down');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
