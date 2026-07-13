const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.postgis.yml');
const EXPORT_DIR = path.join(ROOT, 'db-export');
const CONTAINER = 'hcm_land_postgis';
const DB_NAME = 'hcm_land_mvp';
const DUMP_NAME = 'hcm_land_mvp.dump';
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
  const status = runCapture('docker', [
    'inspect',
    '-f',
    '{{.State.Running}}',
    CONTAINER,
  ]);
  return status === 'true';
}

function ensurePostgis() {
  if (!containerRunning()) {
    console.log('Khởi động PostGIS (Docker)...');
    run('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', 'postgis']);
  }

  console.log('Đợi PostGIS healthy...');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const health = runCapture('docker', [
      'inspect',
      '-f',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}',
      CONTAINER,
    ]);
    if (health === 'healthy') {
      return;
    }
    spawnSync('node', ['-e', 'setTimeout(() => {}, 2000)'], { stdio: 'ignore' });
  }
  throw new Error(`Container ${CONTAINER} chưa healthy sau 120s`);
}

function printCounts() {
  const sql = `
    SELECT 'land_parcels' AS tbl, count(*)::text FROM land_parcels
    UNION ALL SELECT 'hcm_qhsdd', count(*)::text FROM hcm_qhsdd
    UNION ALL SELECT 'users', count(*)::text FROM users
    UNION ALL SELECT 'property_buy_records', count(*)::text FROM property_buy_records;
  `;
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
    sql,
  ]);
  console.log('Số dòng hiện tại:');
  for (const line of out.split('\n').filter(Boolean)) {
    const [tbl, cnt] = line.split('|');
    console.log(`  ${tbl}: ${Number(cnt).toLocaleString('vi-VN')}`);
  }
}

function main() {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });

  ensurePostgis();
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
  console.log(`Hướng dẫn restore: ${path.join(EXPORT_DIR, 'RESTORE.md')}`);
  console.log('Copy thư mục db-export/ sang PC mới, rồi chạy: npm run db:docker:restore');
}

main();
