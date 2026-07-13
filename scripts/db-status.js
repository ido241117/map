const { Client } = require('pg');

const DB_NAME = process.env.PGDATABASE || 'hcm_land_mvp';
const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = Number(process.env.PGPORT || 5432);
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

async function main() {
  const client = new Client({
    host: PGHOST,
    port: PGPORT,
    user: PGUSER,
    password: PGPASSWORD,
    database: DB_NAME,
  });

  await client.connect();

  const tableExists = await client.query(
    "SELECT to_regclass('public.land_parcels') IS NOT NULL AS exists",
  );

  if (!tableExists.rows[0].exists) {
    console.log(`Database: ${DB_NAME}`);
    console.log('land_parcels: chưa có dữ liệu');
    await client.end();
    return;
  }

  const [{ count }] = (
    await client.query('SELECT COUNT(*)::int AS count FROM land_parcels')
  ).rows;

  const meta = await client.query(`
    SELECT key, value, updated_at
    FROM db_meta
    ORDER BY key
  `).catch(() => ({ rows: [] }));

  console.log(`Database: ${DB_NAME}`);
  console.log(`land_parcels: ${count.toLocaleString('vi-VN')} dòng`);

  if (meta.rows.length) {
    console.log('Metadata:');
    for (const row of meta.rows) {
      console.log(`  ${row.key}: ${row.value} (${row.updated_at.toISOString()})`);
    }
  }

  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
