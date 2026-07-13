\set ON_ERROR_STOP on
\timing on

DROP TABLE IF EXISTS property_buy_records_staging;
DROP TABLE IF EXISTS property_buy_records;

CREATE TABLE property_buy_records_staging (
  record_id TEXT,
  customer_name TEXT,
  address TEXT,
  street TEXT,
  ward TEXT,
  district TEXT,
  city TEXT,
  price_buy TEXT
);

\echo 'Copying CSV into staging table...'
\copy property_buy_records_staging FROM '__CSV_PATH__' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

\echo 'Creating property_buy_records table...'
CREATE TABLE property_buy_records (
  id SERIAL PRIMARY KEY,
  record_id BIGINT NOT NULL,
  customer_name TEXT,
  address TEXT NOT NULL,
  street TEXT NOT NULL,
  ward TEXT NOT NULL,
  district TEXT NOT NULL,
  city TEXT NOT NULL,
  price_buy BIGINT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

\echo 'Inserting valid rows from staging...'
INSERT INTO property_buy_records (
  record_id,
  customer_name,
  address,
  street,
  ward,
  district,
  city,
  price_buy
)
SELECT
  NULLIF(BTRIM(record_id), '')::BIGINT,
  NULLIF(BTRIM(customer_name), ''),
  NULLIF(BTRIM(address), ''),
  NULLIF(BTRIM(street), ''),
  NULLIF(BTRIM(ward), ''),
  NULLIF(BTRIM(district), ''),
  NULLIF(BTRIM(city), ''),
  NULLIF(BTRIM(price_buy), '')::BIGINT
FROM property_buy_records_staging
WHERE NULLIF(BTRIM(record_id), '') IS NOT NULL
  AND NULLIF(BTRIM(address), '') IS NOT NULL
  AND NULLIF(BTRIM(street), '') IS NOT NULL
  AND NULLIF(BTRIM(ward), '') IS NOT NULL
  AND NULLIF(BTRIM(district), '') IS NOT NULL
  AND NULLIF(BTRIM(city), '') IS NOT NULL
  AND NULLIF(BTRIM(price_buy), '') IS NOT NULL;

DROP TABLE property_buy_records_staging;

\echo 'Creating indexes...'
CREATE INDEX property_buy_records_record_id_idx ON property_buy_records (record_id);
CREATE INDEX property_buy_records_district_ward_idx ON property_buy_records (district, ward);
CREATE INDEX property_buy_records_price_buy_idx ON property_buy_records (price_buy);

INSERT INTO db_meta (key, value, updated_at)
VALUES
  ('property_buy_records_source', 'New Microsoft Excel Worksheet.xlsx', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

INSERT INTO db_meta (key, value, updated_at)
SELECT 'property_buy_records_count', COUNT(*)::text, now()
FROM property_buy_records
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

\echo 'Import summary:'
SELECT COUNT(*) AS imported_rows FROM property_buy_records;
