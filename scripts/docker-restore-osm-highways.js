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

function waitHealthy() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const health = runCapture('docker', [
      'inspect',
      '-f',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}',
      CONTAINER,
    ]);
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
    `SELECT 'osm_highways', count(*)::text FROM osm_highways;
     SELECT pg_size_pretty(pg_database_size('${DB_NAME}'));`,
  ]);
  console.log('Sau restore:');
  console.log(out);
}

function main() {
  if (!fs.existsSync(DUMP_LOCAL)) {
    console.error(`Không tìm thấy: ${DUMP_LOCAL}`);
    console.error('Copy osm_highways.dump vào db-export/ (từ máy đã chạy npm run db:osm:highways:export).');
    process.exit(1);
  }

  // Volume external — tạo trước nếu VPS chưa có
  run('docker', ['volume', 'create', 'map_osm_highways_pg_data'], { stdio: ['ignore', 'pipe', 'pipe'] });

  const sizeMb = (fs.statSync(DUMP_LOCAL).size / (1024 * 1024)).toFixed(1);
  console.log(`Restore từ ${DUMP_LOCAL} (${sizeMb} MB)`);

  console.log('Khởi động OSM highways PostGIS (port 5435)...');
  run('docker', ['compose', '-p', COMPOSE_PROJECT, '-f', COMPOSE_FILE, 'up', '-d']);
  waitHealthy();

  console.log('CREATE EXTENSION postgis...');
  run('docker', [
    'exec',
    CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-d',
    DB_NAME,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    'CREATE EXTENSION IF NOT EXISTS postgis;',
  ]);

  console.log('Copy dump vào container...');
  run('docker', ['cp', DUMP_LOCAL, `${CONTAINER}:${DUMP_IN_CONTAINER}`]);

  console.log('Restore (pg_restore)...');
  const restore = spawnSync(
    'docker',
    [
      'exec',
      CONTAINER,
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      DB_NAME,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '-j',
      '2',
      DUMP_IN_CONTAINER,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  // pg_restore exit 1 often = warnings only
  if (restore.status !== 0 && restore.status !== 1) {
    console.error(restore.stderr || restore.stdout);
    process.exit(restore.status ?? 1);
  }
  if (restore.stderr) console.log(restore.stderr);

  run('docker', ['exec', CONTAINER, 'rm', '-f', DUMP_IN_CONTAINER]);
  printCounts();

  console.log('\nXong. Connection: postgres://postgres:postgres@localhost:5435/osm_highways');
  console.log('Thêm vào backend/.env: OSM_DATABASE_URL=postgres://postgres:postgres@localhost:5435/osm_highways');
  console.log('Không cần OSM full / map_osm_pg_data trên VPS.');
}

main();
