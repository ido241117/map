'use strict';

const {
  API_URL,
  PARCEL_TILE_PATHS,
  smokeCheck,
  runBench,
  printHeader,
  printResults,
  summarizeBreakingPoint,
  tryGetAuthToken,
} = require('./lib');

const STAGES = (process.env.LOAD_STAGES || '10,25,50')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);

async function main() {
  printHeader('Load test — mixed (tiles + stats + address-suggest)');

  const smoke = await smokeCheck();
  console.log(`Smoke OK — sample tile ~${smoke.tileBytes} bytes`);

  const token = await tryGetAuthToken();
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : null;

  if (!token) {
    console.log(
      'Không có JWT — bỏ qua stats/suggest. Set LOAD_TEST_EMAIL + LOAD_TEST_PASSWORD để test đủ scenario.',
    );
    const rows = [];
    for (const connections of STAGES) {
      console.log(`\n>> Stage ${connections} concurrent (tiles only fallback)...`);
      const row = await runBench({
        label: 'tiles only',
        connections,
        requests: PARCEL_TILE_PATHS.map((path) => ({ method: 'GET', path })),
      });
      rows.push(row);
      printResults([row]);
    }
    summarizeBreakingPoint(rows);
    return;
  }

  console.log('JWT OK — tiles 70%, suggest 20%, stats 10%');

  const weightedRequests = [
    ...PARCEL_TILE_PATHS.map((path) => ({ method: 'GET', path, weight: 7 })),
    {
      method: 'GET',
      path: '/parcels/address-suggest?q=nguyen&limit=10&source=land_parcels',
      weight: 2,
    },
    { method: 'GET', path: '/stats?source=land_parcels', weight: 1 },
  ];

  const rows = [];
  for (const connections of STAGES) {
    console.log(`\n>> Stage ${connections} concurrent...`);
    const row = await runBench({
      label: 'mixed workload',
      connections,
      requests: weightedRequests,
      headers: authHeaders,
    });
    rows.push(row);
    printResults([row]);
  }

  summarizeBreakingPoint(rows);
}

main().catch((err) => {
  console.error(`\nLoad test failed: ${err.message}`);
  process.exit(1);
});
