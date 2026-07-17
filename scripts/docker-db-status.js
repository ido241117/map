const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.postgis.yml');
const CONTAINER = 'hcm_land_postgis';
const DB_NAME = 'hcm_land_mvp';

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

function main() {
  const running = runCapture('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER]);
  if (running !== 'true') {
    console.log(`Container ${CONTAINER} chưa chạy. Chạy: npm run db:docker:up`);
    process.exit(1);
  }

  const health = runCapture('docker', [
    'inspect',
    '-f',
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}',
    CONTAINER,
  ]);
  console.log(`PostGIS: running, health=${health}, port=5433`);

  const out = runCapture('docker', [
    'exec',
    CONTAINER,
    'psql',
    '-U',
    'postgres',
    '-d',
    DB_NAME,
    '-c',
    `SELECT 'land_parcels' AS table_name, count(*) FROM land_parcels
     UNION ALL SELECT 'hcm_qhsdd', count(*) FROM hcm_qhsdd
     UNION ALL SELECT 'users', count(*) FROM users
     UNION ALL SELECT 'property_buy_records', count(*) FROM property_buy_records
     ORDER BY 1;`,
  ]);
  console.log(out);
}

main();
