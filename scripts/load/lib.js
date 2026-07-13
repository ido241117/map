'use strict';

const autocannon = require('autocannon');

const API_URL = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');
const DURATION_SEC = Number(process.env.LOAD_DURATION_SEC || 15);

/** z15 viewport quanh Pasteur / Q1 — db.md §5 */
const PARCEL_TILE_PATHS = [
  '/tiles/land-parcels/15/26096/15397',
  '/tiles/land-parcels/15/26095/15397',
  '/tiles/land-parcels/15/26096/15396',
  '/tiles/land-parcels/15/26097/15397',
  '/tiles/land-parcels/15/26096/15398',
  '/tiles/land-parcels/15/26095/15396',
  '/tiles/land-parcels/15/26097/15396',
  '/tiles/land-parcels/15/26097/15398',
];

const QHSDD_TILE_PATHS = [
  '/tiles/qhsdd/10/814/480',
  '/tiles/qhsdd/10/814/481',
  '/tiles/qhsdd/10/815/480',
];

function formatNumber(n) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

function ms(n) {
  return `${Math.round(n)} ms`;
}

async function smokeCheck() {
  const health = await fetch(`${API_URL}/health`);
  if (!health.ok) {
    throw new Error(`Health check failed: ${health.status} ${health.statusText}`);
  }

  const tile = await fetch(`${API_URL}${PARCEL_TILE_PATHS[0]}`);
  if (!tile.ok) {
    throw new Error(`Tile check failed: ${tile.status} ${tile.statusText}`);
  }
  const tileBytes = Number(tile.headers.get('content-length') || (await tile.arrayBuffer()).byteLength);

  return { health: true, tileBytes };
}

async function runBench({ label, connections, requests, headers }) {
  const result = await autocannon({
    url: API_URL,
    connections,
    duration: DURATION_SEC,
    pipelining: 1,
    requests,
    headers,
  });

  const rps = result.requests.average;
  const failures = result.errors + result.timeouts + result.non2xx;
  const errRate = result.requests.total > 0 ? (failures / result.requests.total) * 100 : 0;

  return {
    label,
    connections,
    durationSec: DURATION_SEC,
    totalRequests: result.requests.total,
    rps: Math.round(rps),
    latencyAvg: result.latency.mean,
    latencyP50: result.latency.p50,
    latencyP95: result.latency.p97_5 || result.latency.p99,
    latencyP99: result.latency.p99,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    errRatePct: errRate,
  };
}

function printHeader(title) {
  console.log('');
  console.log('='.repeat(72));
  console.log(title);
  console.log(`API: ${API_URL}  |  stage: ${DURATION_SEC}s`);
  console.log('='.repeat(72));
}

function printResults(rows) {
  const header =
    'Stage'.padEnd(22) +
    'Conn'.padStart(5) +
    'RPS'.padStart(7) +
    'p50'.padStart(8) +
    'p95'.padStart(8) +
    'p99'.padStart(8) +
    'Err%'.padStart(7) +
    '  Notes';
  console.log(header);
  console.log('-'.repeat(header.length + 10));

  for (const row of rows) {
    const notes = [];
    if (row.errors) notes.push(`errors=${row.errors}`);
    if (row.timeouts) notes.push(`timeouts=${row.timeouts}`);
    if (row.non2xx) notes.push(`non2xx=${row.non2xx}`);

    console.log(
      row.label.padEnd(22) +
        String(row.connections).padStart(5) +
        String(row.rps).padStart(7) +
        ms(row.latencyP50).padStart(8) +
        ms(row.latencyP95).padStart(8) +
        ms(row.latencyP99).padStart(8) +
        `${row.errRatePct.toFixed(2)}%`.padStart(7) +
        (notes.length ? `  ${notes.join(', ')}` : ''),
    );
  }
}

function summarizeBreakingPoint(rows) {
  const bad = rows.find((r) => r.errRatePct > 1 || r.latencyP95 > 2000);
  const last = rows[rows.length - 1];

  console.log('');
  console.log('--- Summary ---');
  if (!bad) {
    console.log(
      `Chưa thấy điểm gãy rõ (err>1% hoặc p95>2s) tới ${last.connections} concurrent connections.`,
    );
    console.log(`Throughput cao nhất: ~${Math.max(...rows.map((r) => r.rps))} req/s.`);
  } else {
    const prev = rows[rows.indexOf(bad) - 1];
    console.log(
      `Điểm gãy sớm nhất: ${bad.connections} conn — p95 ${ms(bad.latencyP95)}, err ${bad.errRatePct.toFixed(2)}%`,
    );
    if (prev) {
      console.log(`Mức ổn định gần nhất trước đó: ${prev.connections} conn (~${prev.rps} req/s, p95 ${ms(prev.latencyP95)}).`);
    }
  }
  console.log(`Tổng request đã bắn: ${formatNumber(rows.reduce((s, r) => s + r.totalRequests, 0))}.`);
}

async function tryGetAuthToken() {
  const email = process.env.LOAD_TEST_EMAIL;
  const password = process.env.LOAD_TEST_PASSWORD;
  if (!email || !password) return null;

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.accessToken || body.token || null;
}

module.exports = {
  API_URL,
  DURATION_SEC,
  PARCEL_TILE_PATHS,
  QHSDD_TILE_PATHS,
  smokeCheck,
  runBench,
  printHeader,
  printResults,
  summarizeBreakingPoint,
  tryGetAuthToken,
};
