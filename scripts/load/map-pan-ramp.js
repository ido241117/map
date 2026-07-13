'use strict';

const { API_URL, smokeCheck, printHeader, summarizeBreakingPoint } = require('./lib');
const { MAP_PAN_VIEWPORTS, QHSDD_BOOTSTRAP_TILES } = require('./map-viewports');

const STAGES = (process.env.LOAD_STAGES || '5,10,20,30,50')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);

const DURATION_SEC = Number(process.env.LOAD_DURATION_SEC || 60);
const PAN_INTERVAL_MS = Number(process.env.LOAD_PAN_INTERVAL_MS || 2000);
const PAN_JITTER_MS = Number(process.env.LOAD_PAN_JITTER_MS || 1000);
const INCLUDE_QHSDD = process.env.LOAD_INCLUDE_QHSDD !== '0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function ms(n) {
  return `${Math.round(n)} ms`;
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function fetchTile(path) {
  const res = await fetch(`${API_URL}${path}`);
  const buf = res.ok ? await res.arrayBuffer() : null;
  return {
    ok: res.ok,
    status: res.status,
    bytes: buf ? buf.byteLength : 0,
  };
}

async function panBurst(viewportTiles, withQhsdd) {
  const tiles = withQhsdd ? [...viewportTiles, ...QHSDD_BOOTSTRAP_TILES] : [...viewportTiles];
  const started = performance.now();
  const results = await Promise.all(tiles.map((path) => fetchTile(path)));
  const elapsed = performance.now() - started;

  const failures = results.filter((r) => !r.ok).length;
  const bytes = results.reduce((sum, r) => sum + r.bytes, 0);

  return {
    elapsed,
    tileCount: tiles.length,
    failures,
    bytes,
    errRatePct: tiles.length ? (failures / tiles.length) * 100 : 0,
  };
}

async function virtualMapUser(userId, until, samples, withQhsdd) {
  let panIndex = userId % MAP_PAN_VIEWPORTS.length;
  let bootstrappedQhsdd = !withQhsdd;

  while (Date.now() < until) {
    const useQhsdd = withQhsdd && !bootstrappedQhsdd;
    if (useQhsdd) bootstrappedQhsdd = true;

    const burst = await panBurst(MAP_PAN_VIEWPORTS[panIndex], useQhsdd);
    samples.push(burst);

    panIndex = (panIndex + 1) % MAP_PAN_VIEWPORTS.length;

    const wait =
      PAN_INTERVAL_MS + Math.floor(Math.random() * (PAN_JITTER_MS + 1));
    await sleep(wait);
  }
}

async function runStage(users) {
  const until = Date.now() + DURATION_SEC * 1000;
  const samples = [];

  await Promise.all(
    Array.from({ length: users }, (_, i) =>
      virtualMapUser(i, until, samples, INCLUDE_QHSDD),
    ),
  );

  const latencies = samples.map((s) => s.elapsed).sort((a, b) => a - b);
  const totalTiles = samples.reduce((sum, s) => sum + s.tileCount, 0);
  const totalBytes = samples.reduce((sum, s) => sum + s.bytes, 0);
  const totalFailures = samples.reduce((sum, s) => sum + s.failures, 0);
  const errRatePct = totalTiles ? (totalFailures / totalTiles) * 100 : 0;

  return {
    label: 'map pan z16',
    users,
    durationSec: DURATION_SEC,
    pans: samples.length,
    tilesPerPan: samples[0]?.tileCount || 0,
    totalTiles,
    totalBytes,
    throughputMbps: (totalBytes * 8) / DURATION_SEC / 1_000_000,
    burstP50: percentile(latencies, 50),
    burstP95: percentile(latencies, 95),
    burstP99: percentile(latencies, 99),
    errRatePct,
    pansPerUser: samples.length / users,
  };
}

function printMapPanResults(rows) {
  const header =
    'Users'.padStart(5) +
    '  Pans'.padStart(6) +
    '  Tiles/pan'.padStart(10) +
    '  Burst p50'.padStart(11) +
    '  Burst p95'.padStart(11) +
    '  MB/s'.padStart(8) +
    '  Err%'.padStart(7);
  console.log(header);
  console.log('-'.repeat(header.length + 4));

  for (const row of rows) {
    console.log(
      String(row.users).padStart(5) +
        String(row.pans).padStart(6) +
        String(row.tilesPerPan).padStart(10) +
        ms(row.burstP50).padStart(11) +
        ms(row.burstP95).padStart(11) +
        row.throughputMbps.toFixed(1).padStart(8) +
        `${row.errRatePct.toFixed(2)}%`.padStart(7),
    );
  }
}

function summarizeMapPan(rows) {
  const bad = rows.find((r) => r.errRatePct > 1 || r.burstP95 > 5000);
  const last = rows[rows.length - 1];

  console.log('');
  console.log('--- Summary (server / máy host) ---');
  console.log(
    `Mỗi pan ≈ ${last.tilesPerPan} tile z16 dense (~5k polygon trên UI) + nghỉ ~${PAN_INTERVAL_MS / 1000}s`,
  );

  if (!bad) {
    console.log(
      `Chưa thấy server quá tải (burst p95>5s hoặc err>1%) tới ${last.users} user đang kéo map.`,
    );
    console.log(
      'Máy vẫn có thể đứng vì CPU/RAM Docker + cloudflared — xem Task Manager khi chạy stage cao.',
    );
  } else {
    const prev = rows[rows.indexOf(bad) - 1];
    console.log(
      `Server bắt đầu suy giảm ~${bad.users} user — burst p95 ${ms(bad.burstP95)}, err ${bad.errRatePct.toFixed(2)}%`,
    );
    if (prev) {
      console.log(`Mức ổn định gần nhất: ~${prev.users} user (burst p95 ${ms(prev.burstP95)}).`);
    }
  }

  console.log(`Tổng dữ liệu tile đã tải: ${formatMb(rows.reduce((s, r) => s + r.totalBytes, 0))}.`);
  console.log('');
  console.log('Lưu ý: test này đo máy HOST (backend + tunnel), không đo lag WebGL trên browser từng user.');
}

async function main() {
  printHeader('Load test — map pan z16 (mô phỏng kéo map ~5k polygon)');

  const smoke = await smokeCheck();
  console.log(`Smoke OK — backend live, sample tile ~${smoke.tileBytes} bytes`);
  console.log(
    `Config: ${DURATION_SEC}s/stage | pan interval ~${PAN_INTERVAL_MS / 1000}s (+0–${PAN_JITTER_MS / 1000}s jitter) | qhsdd=${INCLUDE_QHSDD ? 'on' : 'off'}`,
  );
  console.log('');
  console.log('Trong lúc chạy: mở Task Manager + docker stats + log backend terminal.');
  console.log('Test qua tunnel: API_URL=https://your-tunnel.example npm run load:map-pan');

  const rows = [];
  for (const users of STAGES) {
    console.log(`\n>> ${users} user đang kéo map (${DURATION_SEC}s)...`);
    const row = await runStage(users);
    rows.push(row);
    printMapPanResults([row]);
  }

  summarizeMapPan(rows);
}

main().catch((err) => {
  console.error(`\nLoad test failed: ${err.message}`);
  process.exit(1);
});
