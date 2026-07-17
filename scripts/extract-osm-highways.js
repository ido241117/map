/**
 * Extract highways + railways from full OSM PostGIS (port 5434 / map_osm_pg_data)
 * into slim DB (port 5435 / map_osm_highways_pg_data).
 *
 * Usage:
 *   npm run db:osm:up              # nguồn full (nếu chưa chạy)
 *   npm run db:osm:highways:up     # đích slim
 *   npm run db:osm:highways:extract
 *
 * --force  : xóa bảng trên đích rồi restore lại
 *
 * Tạo thiếu từng bảng nếu chưa có (không cần --force khi chỉ thiếu railways).
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

/** @typedef {{ key: string, exportTable: string, finalTable: string, dumpName: string, where: string, selectCols: string, indexes: string[], verifyExtra?: string }} LayerSpec */

/** @type {LayerSpec[]} */
const LAYERS = [
  {
    key: 'highways',
    exportTable: 'osm_highways_export',
    finalTable: 'osm_highways',
    dumpName: 'osm_highways.dump',
    where: 'highway IS NOT NULL',
    selectCols: `
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
      way`,
    indexes: ['way', 'osm_id', 'highway'],
    verifyExtra: `
      COUNT(DISTINCT highway) AS highway_types,
      (SELECT highway FROM osm_highways GROUP BY highway ORDER BY COUNT(*) DESC LIMIT 1) AS top_highway`,
  },
  {
    key: 'railways',
    exportTable: 'osm_railways_export',
    finalTable: 'osm_railways',
    dumpName: 'osm_railways.dump',
    where: 'railway IS NOT NULL',
    selectCols: `
      osm_id,
      name,
      railway,
      ref,
      z_order,
      bridge,
      tunnel,
      layer,
      service,
      way`,
    indexes: ['way', 'osm_id', 'railway'],
    verifyExtra: `
      COUNT(DISTINCT railway) AS railway_types,
      (SELECT railway FROM osm_railways GROUP BY railway ORDER BY COUNT(*) DESC LIMIT 1) AS top_railway`,
  },
];

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

function tableExists(finalTable) {
  return (
    dockerExec(TARGET_CONTAINER, [
      'psql',
      '-U',
      'postgres',
      '-d',
      TARGET_DB,
      '-tAc',
      `SELECT to_regclass('public.${finalTable}') IS NOT NULL`,
    ]) === 't'
  );
}

function printTableStats(finalTable) {
  const stats = dockerExecPg(
    TARGET_CONTAINER,
    TARGET_DB,
    `SELECT COUNT(*) AS rows, pg_size_pretty(pg_total_relation_size('${finalTable}')) AS size FROM ${finalTable};`,
  );
  console.log(stats);
}

/**
 * @param {LayerSpec} layer
 */
function extractLayer(layer) {
  const dumpInContainer = `/tmp/${layer.dumpName}`;
  const indexSql = layer.indexes
    .map((col) => {
      if (col === 'way') {
        return `CREATE INDEX ${layer.exportTable}_way_idx ON ${layer.exportTable} USING GIST (way);`;
      }
      return `CREATE INDEX ${layer.exportTable}_${col}_idx ON ${layer.exportTable} (${col});`;
    })
    .join('\n');
  const renameIndexes = layer.indexes
    .map((col) => {
      const suffix = col === 'way' ? 'way_idx' : `${col}_idx`;
      return `ALTER INDEX IF EXISTS ${layer.exportTable}_${suffix} RENAME TO ${layer.finalTable}_${suffix};`;
    })
    .join('\n');

  console.log(`\n=== ${layer.key}: tạo bảng tạm ${layer.exportTable} (${layer.where})…`);
  dockerExecPg(
    SOURCE_CONTAINER,
    SOURCE_DB,
    `
    DROP TABLE IF EXISTS ${layer.exportTable};
    CREATE TABLE ${layer.exportTable} AS
    SELECT ${layer.selectCols}
    FROM planet_osm_line
    WHERE ${layer.where};
    ${indexSql}
    ANALYZE ${layer.exportTable};
    `,
  );

  console.log(`${layer.key}: pg_dump → file trong container nguồn…`);
  dockerExec(SOURCE_CONTAINER, [
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    SOURCE_DB,
    '-Fc',
    '-t',
    layer.exportTable,
    '-f',
    dumpInContainer,
  ]);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `osm-${layer.key}-`));
  const localDump = path.join(tmpDir, layer.dumpName);
  try {
    console.log(`${layer.key}: docker cp dump sang đích…`);
    run('docker', ['cp', `${SOURCE_CONTAINER}:${dumpInContainer}`, localDump]);
    run('docker', ['cp', localDump, `${TARGET_CONTAINER}:${dumpInContainer}`]);

    console.log(`${layer.key}: CREATE EXTENSION + pg_restore trên đích…`);
    dockerExecPg(TARGET_CONTAINER, TARGET_DB, 'CREATE EXTENSION IF NOT EXISTS postgis;');
    dockerExecPg(
      TARGET_CONTAINER,
      TARGET_DB,
      `DROP TABLE IF EXISTS ${layer.finalTable}; DROP TABLE IF EXISTS ${layer.exportTable};`,
    );
    dockerExec(TARGET_CONTAINER, [
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      TARGET_DB,
      '--no-owner',
      '--no-acl',
      dumpInContainer,
    ]);
    dockerExecPg(
      TARGET_CONTAINER,
      TARGET_DB,
      `ALTER TABLE ${layer.exportTable} RENAME TO ${layer.finalTable};
       ${renameIndexes}
       ANALYZE ${layer.finalTable};`,
    );

    console.log(`${layer.key}: dọn bảng/file tạm trên nguồn…`);
    dockerExecPg(SOURCE_CONTAINER, SOURCE_DB, `DROP TABLE IF EXISTS ${layer.exportTable};`);
    dockerExec(SOURCE_CONTAINER, ['rm', '-f', dumpInContainer]);
    dockerExec(TARGET_CONTAINER, ['rm', '-f', dumpInContainer]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const verify = dockerExecPg(
    TARGET_CONTAINER,
    TARGET_DB,
    `
    SELECT
      COUNT(*) AS rows,
      pg_size_pretty(pg_total_relation_size('${layer.finalTable}')) AS table_size,
      Find_SRID('public','${layer.finalTable}','way') AS srid
      ${layer.verifyExtra ? `, ${layer.verifyExtra}` : ''}
    FROM ${layer.finalTable};
    `,
  );
  console.log(verify);
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

  /** @type {LayerSpec[]} */
  const toExtract = [];
  for (const layer of LAYERS) {
    const exists = tableExists(layer.finalTable);
    if (exists && !force) {
      console.log(`Bảng ${layer.finalTable} đã có trên ${TARGET_DB}. Thêm --force để extract lại.`);
      printTableStats(layer.finalTable);
      continue;
    }
    toExtract.push(layer);
  }

  if (toExtract.length === 0) {
    console.log('\nKhông có lớp nào cần extract.');
    return;
  }

  for (const layer of toExtract) {
    extractLayer(layer);
  }

  console.log('\nXong. App dùng: postgres://postgres:postgres@localhost:5435/osm_highways');
  console.log('  → bảng osm_highways + osm_railways');
  console.log('Nguồn full (5434) có thể tắt: npm run db:osm:down');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
