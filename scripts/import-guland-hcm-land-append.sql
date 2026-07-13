\set ON_ERROR_STOP on
\timing on

DROP TABLE IF EXISTS guland_hcm_land_staging;

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

\echo 'Staging rows:'
SELECT COUNT(*) AS staging_rows FROM guland_hcm_land_staging;

CREATE UNIQUE INDEX IF NOT EXISTS guland_hcm_land_parcel_id_uniq ON guland_hcm_land (parcel_id);

\echo 'Updating existing rows by parcel_id...'
WITH valid_staging AS (
  SELECT
    NULLIF(BTRIM(parcel_id), '')::BIGINT AS parcel_id,
    CASE
      WHEN NULLIF(BTRIM(old_id), '') IS NULL THEN NULL
      ELSE BTRIM(old_id)::DOUBLE PRECISION::BIGINT
    END AS old_id,
    NULLIF(BTRIM(sheet), '') AS sheet,
    NULLIF(BTRIM(plot), '') AS plot,
    NULLIF(BTRIM(total_area), '')::DOUBLE PRECISION AS total_area,
    NULLIF(BTRIM(address), '') AS address,
    NULLIF(BTRIM(province_id), '')::INTEGER AS province_id,
    NULLIF(BTRIM(district_id), '')::INTEGER AS district_id,
    NULLIF(BTRIM(ward_id), '')::INTEGER AS ward_id,
    NULLIF(BTRIM(location_new), '') AS location_new,
    NULLIF(BTRIM(location_old), '') AS location_old,
    NULLIF(BTRIM(land_uses_json), '')::JSONB AS land_uses_json,
    NULLIF(BTRIM(planning_json), '')::JSONB AS planning_json,
    NULLIF(BTRIM(geometry_json), '')::JSONB AS geometry_json,
    NULLIF(BTRIM(shape_json), '')::JSONB AS shape_json,
    NULLIF(BTRIM(latitude), '')::DOUBLE PRECISION AS latitude,
    NULLIF(BTRIM(longitude), '')::DOUBLE PRECISION AS longitude,
    NULLIF(BTRIM(scan_lat), '')::DOUBLE PRECISION AS scan_lat,
    NULLIF(BTRIM(scan_lng), '')::DOUBLE PRECISION AS scan_lng
  FROM guland_hcm_land_staging
  WHERE NULLIF(BTRIM(parcel_id), '') IS NOT NULL
    AND NULLIF(BTRIM(latitude), '') IS NOT NULL
    AND NULLIF(BTRIM(longitude), '') IS NOT NULL
)
UPDATE guland_hcm_land g
SET
  old_id = s.old_id,
  sheet = s.sheet,
  plot = s.plot,
  total_area = s.total_area,
  address = s.address,
  province_id = s.province_id,
  district_id = s.district_id,
  ward_id = s.ward_id,
  location_new = s.location_new,
  location_old = s.location_old,
  land_uses_json = s.land_uses_json,
  planning_json = s.planning_json,
  geometry_json = s.geometry_json,
  shape_json = s.shape_json,
  latitude = s.latitude,
  longitude = s.longitude,
  scan_lat = s.scan_lat,
  scan_lng = s.scan_lng,
  imported_at = now()
FROM valid_staging s
WHERE g.parcel_id = s.parcel_id;

\echo 'Inserting new rows...'
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
FROM guland_hcm_land_staging s
WHERE NULLIF(BTRIM(parcel_id), '') IS NOT NULL
  AND NULLIF(BTRIM(latitude), '') IS NOT NULL
  AND NULLIF(BTRIM(longitude), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM guland_hcm_land g
    WHERE g.parcel_id = NULLIF(BTRIM(s.parcel_id), '')::BIGINT
  );

DROP TABLE guland_hcm_land_staging;

ANALYZE guland_hcm_land;

INSERT INTO db_meta (key, value, updated_at)
VALUES
  ('guland_hcm_land_source', 'guland_hcm_land.csv', now()),
  ('guland_hcm_land_import_mode', 'append', now()),
  ('guland_hcm_land_last_append_at', now()::text, now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

INSERT INTO db_meta (key, value, updated_at)
SELECT 'guland_hcm_land_row_count', COUNT(*)::text, now()
FROM guland_hcm_land
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

\echo 'Append summary:'
SELECT COUNT(*) AS total_rows FROM guland_hcm_land;
