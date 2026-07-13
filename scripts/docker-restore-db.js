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

function waitHealthy() {
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
    UNION ALL SELECT 'hcm_qhsdd', count(*)::text FROM hcm_qhsdd;
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
  console.log('Số dòng sau restore:');
  for (const line of out.split('\n').filter(Boolean)) {
    const [tbl, cnt] = line.split('|');
    console.log(`  ${tbl}: ${Number(cnt).toLocaleString('vi-VN')}`);
  }
}

function main() {
  if (!fs.existsSync(DUMP_LOCAL)) {
    console.error(`Không tìm thấy: ${DUMP_LOCAL}`);
    console.error('Copy thư mục db-export/ từ PC cũ vào root project.');
    process.exit(1);
  }

  const sizeMb = (fs.statSync(DUMP_LOCAL).size / (1024 * 1024)).toFixed(1);
  console.log(`Restore từ ${DUMP_LOCAL} (${sizeMb} MB)`);

  console.log('Khởi động PostGIS (Docker)...');
  run('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', 'postgis']);
  waitHealthy();

  console.log('Copy dump vào container...');
  run('docker', ['cp', DUMP_LOCAL, `${CONTAINER}:${DUMP_IN_CONTAINER}`]);

  console.log('Restore (pg_restore, có thể mất vài phút)...');
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
      '4',
      DUMP_IN_CONTAINER,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );

  run('docker', ['exec', CONTAINER, 'rm', '-f', DUMP_IN_CONTAINER]);

  // pg_restore trả exit 1 khi có warning (vd. object chưa tồn tại lúc --clean) — vẫn OK nếu data có
  if (restore.status !== 0 && restore.status !== 1) {
    process.exit(restore.status ?? 1);
  }

  printCounts();
  console.log('\nRestore xong. Tiếp theo: npm run es:setup');
}

main();
