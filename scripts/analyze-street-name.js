/**
 * Analyze street_name extraction quality on land_parcels.
 * Run: node scripts/analyze-street-name.js
 */
const { Client } = require('pg');
const { extractStreetName } = require('../lib/address-normalize');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5433/hcm_land_mvp';

async function main() {
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  const { rows: sample } = await pg.query(`
    SELECT id, address, ward, district, province
    FROM land_parcels
    TABLESAMPLE SYSTEM (1.2)
    LIMIT 20000
  `);

  const qualityCounts = {};
  const topStreets = new Map();
  let empty = 0;

  for (const row of sample) {
    const extracted = extractStreetName(row.address, row.ward, row.district, row.province);
    const key = extracted.street_name ? 'has_street' : 'empty';
    qualityCounts[key] = (qualityCounts[key] || 0) + 1;
    if (!extracted.street_name) {
      empty += 1;
      continue;
    }
    topStreets.set(extracted.street_name, (topStreets.get(extracted.street_name) || 0) + 1);
  }

  console.log('Sample size:', sample.length);
  console.log('Empty street_name:', empty, `(${((100 * empty) / sample.length).toFixed(2)}%)`);
  console.log('\nTop street_name in sample:');
  [...topStreets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([name, cnt]) => console.log(`  ${cnt.toString().padStart(5)}  ${name}`));

  await pg.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
