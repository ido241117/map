'use strict';

const {
  API_URL,
  PARCEL_TILE_PATHS,
  QHSDD_TILE_PATHS,
  smokeCheck,
  runBench,
  printHeader,
  printResults,
  summarizeBreakingPoint,
} = require('./lib');

const STAGES = (process.env.LOAD_STAGES || '10,25,50,100')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);

const parcelRequests = PARCEL_TILE_PATHS.map((path) => ({ method: 'GET', path }));
const mixedTileRequests = [
  ...parcelRequests,
  ...QHSDD_TILE_PATHS.map((path) => ({ method: 'GET', path })),
];

async function main() {
  printHeader('Load test — MVT tiles (cache hit, no auth)');

  const smoke = await smokeCheck();
  console.log(`Smoke OK — health 200, sample tile ~${smoke.tileBytes} bytes`);

  const rows = [];
  for (const connections of STAGES) {
    console.log(`\n>> Stage ${connections} concurrent connections...`);
    const row = await runBench({
      label: `tiles z15+z12`,
      connections,
      requests: mixedTileRequests,
    });
    rows.push(row);
    printResults([row]);
  }

  summarizeBreakingPoint(rows);
  console.log('\nGợi ý: xem log backend terminal trong lúc chạy. Tăng stage: LOAD_STAGES=10,25,50,100,200 npm run load:tiles');
}

main().catch((err) => {
  console.error(`\nLoad test failed: ${err.message}`);
  console.error(`Đảm bảo backend live tại ${API_URL}`);
  process.exit(1);
});
