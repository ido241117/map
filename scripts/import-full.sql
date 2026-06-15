\set ON_ERROR_STOP on
\timing on

DROP TABLE IF EXISTS land_parcels_staging;
DROP TABLE IF EXISTS land_parcels;

CREATE TABLE land_parcels_staging (
  shape_file_id TEXT,
  property_code TEXT,
  address TEXT,
  latitude TEXT,
  longitude TEXT,
  total_area TEXT,
  planning_land_type TEXT,
  province TEXT,
  province_code TEXT,
  district TEXT,
  district_code TEXT,
  ward TEXT,
  ward_code TEXT,
  property_uuid TEXT,
  geometry_json TEXT
);

\echo 'Copying CSV into staging table...'
\copy land_parcels_staging FROM '__CSV_PATH__' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

\echo 'Creating land_parcels table...'
CREATE TABLE land_parcels (
  id SERIAL PRIMARY KEY,
  shape_file_id BIGINT,
  property_code TEXT,
  address TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  total_area DOUBLE PRECISION,
  planning_land_type TEXT,
  province TEXT,
  province_code TEXT,
  district TEXT,
  district_code TEXT,
  ward TEXT,
  ward_code TEXT,
  property_uuid TEXT,
  geometry_json JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

\echo 'Inserting valid rows from staging...'
INSERT INTO land_parcels (
  shape_file_id,
  property_code,
  address,
  latitude,
  longitude,
  total_area,
  planning_land_type,
  province,
  province_code,
  district,
  district_code,
  ward,
  ward_code,
  property_uuid,
  geometry_json
)
SELECT
  NULLIF(BTRIM(shape_file_id), '')::BIGINT,
  NULLIF(BTRIM(property_code), ''),
  NULLIF(BTRIM(address), ''),
  NULLIF(BTRIM(latitude), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(longitude), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(total_area), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(planning_land_type), ''),
  NULLIF(BTRIM(province), ''),
  NULLIF(BTRIM(province_code), ''),
  NULLIF(BTRIM(district), ''),
  NULLIF(BTRIM(district_code), ''),
  NULLIF(BTRIM(ward), ''),
  NULLIF(BTRIM(ward_code), ''),
  NULLIF(BTRIM(property_uuid), ''),
  geometry_json::JSONB
FROM land_parcels_staging
WHERE NULLIF(BTRIM(latitude), '') IS NOT NULL
  AND NULLIF(BTRIM(longitude), '') IS NOT NULL
  AND NULLIF(BTRIM(geometry_json), '') IS NOT NULL
  AND geometry_json::JSONB ->> 'type' = 'MultiPolygon';

DROP TABLE land_parcels_staging;

\echo 'Creating indexes...'
CREATE INDEX land_parcels_lat_lng_idx ON land_parcels (latitude, longitude);
CREATE INDEX land_parcels_property_code_idx ON land_parcels (property_code);
CREATE INDEX land_parcels_admin_idx ON land_parcels (district, ward);
CREATE INDEX land_parcels_land_type_idx ON land_parcels (planning_land_type);

CREATE TABLE IF NOT EXISTS db_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO db_meta (key, value, updated_at)
VALUES
  ('dataset', 'hcm_land_full', now()),
  ('source_csv', 'scan/crawler/data/hcm_land_data.csv', now()),
  ('import_mode', 'full', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

INSERT INTO db_meta (key, value, updated_at)
SELECT 'row_count', COUNT(*)::text, now()
FROM land_parcels
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

\echo 'Import summary:'
SELECT COUNT(*) AS imported_rows FROM land_parcels;
