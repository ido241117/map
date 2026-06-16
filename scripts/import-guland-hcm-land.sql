\set ON_ERROR_STOP on
\timing on

DROP TABLE IF EXISTS guland_hcm_land_staging;
DROP TABLE IF EXISTS guland_hcm_land;

CREATE TABLE guland_hcm_land_staging (
  parcel_id TEXT,
  old_id TEXT,
  sheet TEXT,
  plot TEXT,
  total_area TEXT,
  address TEXT,
  province_id TEXT,
  district_id TEXT,
  ward_id TEXT,
  location_new TEXT,
  location_old TEXT,
  land_uses_json TEXT,
  planning_json TEXT,
  geometry_json TEXT,
  shape_json TEXT,
  latitude TEXT,
  longitude TEXT,
  scan_lat TEXT,
  scan_lng TEXT
);

\echo 'Copying CSV into staging table...'
\copy guland_hcm_land_staging FROM '__CSV_PATH__' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

\echo 'Creating guland_hcm_land table...'
CREATE TABLE guland_hcm_land (
  id SERIAL PRIMARY KEY,
  parcel_id BIGINT NOT NULL,
  old_id BIGINT,
  sheet TEXT,
  plot TEXT,
  total_area DOUBLE PRECISION,
  address TEXT,
  province_id INTEGER,
  district_id INTEGER,
  ward_id INTEGER,
  location_new TEXT,
  location_old TEXT,
  land_uses_json JSONB,
  planning_json JSONB,
  geometry_json JSONB,
  shape_json JSONB,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  scan_lat DOUBLE PRECISION,
  scan_lng DOUBLE PRECISION,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

\echo 'Inserting valid rows from staging...'
INSERT INTO guland_hcm_land (
  parcel_id,
  old_id,
  sheet,
  plot,
  total_area,
  address,
  province_id,
  district_id,
  ward_id,
  location_new,
  location_old,
  land_uses_json,
  planning_json,
  geometry_json,
  shape_json,
  latitude,
  longitude,
  scan_lat,
  scan_lng
)
SELECT
  NULLIF(BTRIM(parcel_id), '')::BIGINT,
  CASE
    WHEN NULLIF(BTRIM(old_id), '') IS NULL THEN NULL
    ELSE BTRIM(old_id)::DOUBLE PRECISION::BIGINT
  END,
  NULLIF(BTRIM(sheet), ''),
  NULLIF(BTRIM(plot), ''),
  NULLIF(BTRIM(total_area), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(address), ''),
  NULLIF(BTRIM(province_id), '')::INTEGER,
  NULLIF(BTRIM(district_id), '')::INTEGER,
  NULLIF(BTRIM(ward_id), '')::INTEGER,
  NULLIF(BTRIM(location_new), ''),
  NULLIF(BTRIM(location_old), ''),
  NULLIF(BTRIM(land_uses_json), '')::JSONB,
  NULLIF(BTRIM(planning_json), '')::JSONB,
  NULLIF(BTRIM(geometry_json), '')::JSONB,
  NULLIF(BTRIM(shape_json), '')::JSONB,
  NULLIF(BTRIM(latitude), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(longitude), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(scan_lat), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(scan_lng), '')::DOUBLE PRECISION
FROM guland_hcm_land_staging
WHERE NULLIF(BTRIM(parcel_id), '') IS NOT NULL
  AND NULLIF(BTRIM(latitude), '') IS NOT NULL
  AND NULLIF(BTRIM(longitude), '') IS NOT NULL;

DROP TABLE guland_hcm_land_staging;

\echo 'Creating indexes...'
CREATE INDEX guland_hcm_land_parcel_id_idx ON guland_hcm_land (parcel_id);
CREATE INDEX guland_hcm_land_lat_lng_idx ON guland_hcm_land (latitude, longitude);
CREATE INDEX guland_hcm_land_admin_idx ON guland_hcm_land (district_id, ward_id);
CREATE INDEX guland_hcm_land_total_area_idx ON guland_hcm_land (total_area);

INSERT INTO db_meta (key, value, updated_at)
VALUES
  ('guland_hcm_land_source', 'guland_hcm_land.csv', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

INSERT INTO db_meta (key, value, updated_at)
SELECT 'guland_hcm_land_row_count', COUNT(*)::text, now()
FROM guland_hcm_land
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

\echo 'Import summary:'
SELECT COUNT(*) AS imported_rows FROM guland_hcm_land;
