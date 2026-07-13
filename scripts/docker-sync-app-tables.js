/**
 * Sync app tables from local PostgreSQL (5432) → Docker PostGIS (5433).
 * Does not touch land_parcels / hcm_qhsdd (already synced with PostGIS geom).
 *
 * Tables: users, property_buy_records
 */
const { Client } = require('pg');

const SRC = {
  host: process.env.SRC_PGHOST || 'localhost',
  port: Number(process.env.SRC_PGPORT || 5432),
  user: process.env.SRC_PGUSER || 'postgres',
  password: process.env.SRC_PGPASSWORD || 'postgres',
  database: process.env.SRC_PGDATABASE || 'hcm_land_mvp',
};

const DEST = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'hcm_land_mvp',
};

const APP_TABLES = ['users', 'property_buy_records'];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS property_buy_records (
  id SERIAL PRIMARY KEY,
  record_id BIGINT NOT NULL,
  customer_name TEXT,
  address TEXT NOT NULL,
  street TEXT NOT NULL,
  ward TEXT NOT NULL,
  district TEXT NOT NULL,
  city TEXT NOT NULL,
  price_buy BIGINT NOT NULL,
  string TEXT,
  lat DOUBLE PRECISION,
  long DOUBLE PRECISION,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS property_buy_records_record_id_idx ON property_buy_records (record_id);
CREATE INDEX IF NOT EXISTS property_buy_records_district_ward_idx ON property_buy_records (district, ward);
CREATE INDEX IF NOT EXISTS property_buy_records_price_buy_idx ON property_buy_records (price_buy);
`;

async function tableColumns(client, table) {
  const { rows } = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
    `,
    [table],
  );
  return rows.map((r) => r.column_name);
}

async function copyTable(src, dest, table) {
  const columns = await tableColumns(src, table);
  if (!columns.length) {
    throw new Error(`Bảng nguồn không tồn tại hoặc rỗng schema: ${table}`);
  }

  const destColumns = await tableColumns(dest, table);
  const shared = columns.filter((c) => destColumns.includes(c));
  if (!shared.length) {
    throw new Error(`Không có cột chung giữa source/dest cho bảng ${table}`);
  }

  const total = Number(
    (await src.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count,
  );

  console.log(`Sync ${table}: ${total.toLocaleString('vi-VN')} dòng...`);
  await dest.query(`TRUNCATE ${table} RESTART IDENTITY`);

  if (total === 0) {
    console.log(`  (trống)`);
    return 0;
  }

  const colList = shared.join(', ');
  const { rows } = await src.query(`SELECT ${colList} FROM ${table} ORDER BY id`);
  const values = [];
  const params = [];
  let i = 1;

  for (const row of rows) {
    const placeholders = shared.map(() => `$${i++}`).join(',');
    values.push(`(${placeholders})`);
    for (const col of shared) {
      params.push(row[col]);
    }
  }

  await dest.query(
    `INSERT INTO ${table} (${colList}) VALUES ${values.join(',')}`,
    params,
  );

  await dest.query(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`,
  );

  console.log(`  -> ${rows.length.toLocaleString('vi-VN')} dòng`);
  return rows.length;
}

async function updateMeta(dest, counts) {
  await dest.query(
    `
    INSERT INTO db_meta (key, value, updated_at)
    VALUES
      ('users_count', $1, now()),
      ('property_buy_records_count', $2, now()),
      ('app_tables_synced_from', $3, now())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `,
    [
      String(counts.users),
      String(counts.property_buy_records),
      `${SRC.host}:${SRC.port}/${SRC.database}`,
    ],
  );
}

async function main() {
  console.log('=== Sync app tables: local → Docker ===');
  console.log(`Source: ${SRC.host}:${SRC.port}/${SRC.database}`);
  console.log(`Dest:   ${DEST.host}:${DEST.port}/${DEST.database}`);
  console.log(`Tables: ${APP_TABLES.join(', ')}`);
  console.log('');

  const src = new Client(SRC);
  const dest = new Client(DEST);
  await src.connect();
  await dest.connect();

  try {
    for (const table of APP_TABLES) {
      const exists = await src.query(
        `SELECT to_regclass('public.${table}') IS NOT NULL AS exists`,
      );
      if (!exists.rows[0].exists) {
        throw new Error(`Bảng ${table} không có trên source (${SRC.port})`);
      }
    }

    await dest.query(SCHEMA_SQL);

    const counts = {};
    for (const table of APP_TABLES) {
      counts[table] = await copyTable(src, dest, table);
    }

    await updateMeta(dest, {
      users: counts.users,
      property_buy_records: counts.property_buy_records,
    });
  } finally {
    await dest.end();
    await src.end();
  }

  console.log('');
  console.log('=== Xong ===');
  console.log(`Docker: postgres://postgres:postgres@${DEST.host}:${DEST.port}/${DEST.database}`);
  console.log('Đặt backend DATABASE_URL trỏ port 5433.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
