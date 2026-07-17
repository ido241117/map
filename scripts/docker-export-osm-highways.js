const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.osm-highways.yml');
const COMPOSE_PROJECT = 'map-osm-highways';
const EXPORT_DIR = path.join(ROOT, 'db-export');
const CONTAINER = 'osm_highways_postgis';
const DB_NAME = 'osm_highways';
const DUMP_NAME = 'osm_highways.dump';
const DUMP_IN_CONTAINER = `/tmp/${DUMP_NAME}`;
const DUMP_LOCAL = path.join(EXPORT_DIR, DUMP_NAME);

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

function runCapture(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return (result.stdout || '').trim();
}

function containerRunning() {
  try {
    return runCapture('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER]) === 'true';
  } catch {
    return false;
  }
}

function ensureHighwaysDb() {
  if (!containerRunning()) {
    console.log('Khởi động OSM highways PostGIS...');
    run('docker', ['compose', '-p', COMPOSE_PROJECT, '-f', COMPOSE_FILE, 'up', '-d']);
  }

  console.log('Đợi osm_highways_postgis healthy...');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    let health = 'unknown';
    try {
      health = runCapture('docker', [
        'inspect',
        '-f',
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}',
        CONTAINER,
      ]);
    } catch {
      health = 'missing';
    }
    if (health === 'healthy') return;
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], { stdio: 'ignore' });
  }
  throw new Error(`Container ${CONTAINER} chưa healthy sau 120s`);
}

function printCounts() {
  const out = runCapture('docker', [
    'exec',
    CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-d',
    DB_NAME,
    '-t',
    '-A',
    '-c',
    `SELECT 'osm_highways',
       CASE WHEN to_regclass('public.osm_highways') IS NULL THEN '0'
            ELSE (SELECT count(*)::text FROM osm_highways) END
     UNION ALL
     SELECT 'osm_railways',
       CASE WHEN to_regclass('public.osm_railways') IS NULL THEN '0'
            ELSE (SELECT count(*)::text FROM osm_railways) END;`,
  ]);
  console.log('Số dòng hiện tại:');
  for (const line of out.split('\n').filter(Boolean)) {
    const [tbl, cnt] = line.split('|');
    console.log(`  ${tbl}: ${Number(cnt).toLocaleString('vi-VN')}`);
  }
}

function main() {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  ensureHighwaysDb();
  printCounts();

  console.log(`\nDump DB → ${DUMP_IN_CONTAINER} (trong container)...`);
  run('docker', [
    'exec',
    CONTAINER,
    'pg_dump',
    '-U',
    'postgres',
    '-Fc',
    '--no-owner',
    '--no-acl',
    '-d',
    DB_NAME,
    '-f',
    DUMP_IN_CONTAINER,
  ]);

  console.log(`Copy ra máy host → ${DUMP_LOCAL}`);
  run('docker', ['cp', `${CONTAINER}:${DUMP_IN_CONTAINER}`, DUMP_LOCAL]);
  run('docker', ['exec', CONTAINER, 'rm', '-f', DUMP_IN_CONTAINER]);

  const sizeMb = (fs.statSync(DUMP_LOCAL).size / (1024 * 1024)).toFixed(1);
  console.log(`\nXong. File: ${DUMP_LOCAL} (${sizeMb} MB)`);
  console.log('Copy osm_highways.dump lên VPS cùng db-export/, rồi: npm run db:osm:highways:restore');
  console.log('Dump gồm osm_highways + osm_railways (nếu đã extract). Không cần volume OSM full.');
}

main();
