const { Client } = require('pg');

async function main() {
  const c = new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'hcm_land_mvp',
  });
  await c.connect();

  const summary = await c.query(`
    SELECT COUNT(*)::int AS total_plots,
           COUNT(DISTINCT ward_code)::int AS distinct_wards,
           COUNT(DISTINCT district_code)::int AS distinct_districts
    FROM land_parcels
  `);
  console.log('=== DB SUMMARY ===');
  console.log(summary.rows[0]);

  const capped = await c.query(`
    SELECT ward_code, district_code, district, ward, COUNT(*)::int AS plot_count
    FROM land_parcels
    GROUP BY 1, 2, 3, 4
    HAVING COUNT(*) >= 9900
    ORDER BY plot_count DESC, ward_code
  `);
  console.log('\n=== WARDS >= 9900 plots (likely 10k cap) ===');
  console.log('count:', capped.rowCount);
  for (const r of capped.rows) {
    console.log(`  ${r.ward_code}  [${r.district_code}] ${r.ward}  ${r.plot_count.toLocaleString()}`);
  }

  const nearCap = await c.query(`
    SELECT ward_code, district_code, district, ward, COUNT(*)::int AS plot_count
    FROM land_parcels
    GROUP BY 1, 2, 3, 4
    HAVING COUNT(*) BETWEEN 3900 AND 9899
    ORDER BY plot_count DESC
    LIMIT 30
  `);
  console.log('\n=== WARDS 3900-9899 (top 30) ===');
  for (const r of nearCap.rows) {
    console.log(`  ${r.ward_code}  [${r.district_code}] ${r.ward}  ${r.plot_count.toLocaleString()}`);
  }

  const byPrefix = await c.query(`
    SELECT LEFT(ward_code, 3) AS prefix,
           COUNT(DISTINCT ward_code)::int AS wards,
           COUNT(*)::int AS plots
    FROM land_parcels
    WHERE ward_code ~ '^[0-9]{5}$'
    GROUP BY 1
    ORDER BY 1
  `);
  console.log('\n=== BY WARD PREFIX ===');
  for (const r of byPrefix.rows) {
    console.log(`  ${r.prefix}xx: ${r.wards} wards, ${Number(r.plots).toLocaleString()} plots`);
  }

  const allWards = await c.query(`
    SELECT ward_code, district_code, district, ward, COUNT(*)::int AS plot_count
    FROM land_parcels
    GROUP BY 1, 2, 3, 4
    ORDER BY district_code, ward_code
  `);
  console.log('\n=== ALL WARDS CSV (ward_code,district_code,plot_count) ===');
  console.log('ward_code,district_code,district,ward,plot_count');
  for (const r of allWards.rows) {
    const ward = String(r.ward || '').replace(/,/g, ' ');
    const district = String(r.district || '').replace(/,/g, ' ');
    console.log(`${r.ward_code},${r.district_code},"${district}","${ward}",${r.plot_count}`);
  }

  await c.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
