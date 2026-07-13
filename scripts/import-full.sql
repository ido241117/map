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

\echo 'Inserting valid HCM rows (province_code=79, deduped by shape_file_id)...'
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
FROM (
  SELECT
    NULLIF(BTRIM(s.shape_file_id), '')::BIGINT AS shape_file_id,
    NULLIF(BTRIM(s.property_code), '') AS property_code,
    NULLIF(BTRIM(s.address), '') AS address,
    NULLIF(BTRIM(s.latitude), '')::DOUBLE PRECISION AS latitude,
    NULLIF(BTRIM(s.longitude), '')::DOUBLE PRECISION AS longitude,
    NULLIF(BTRIM(s.total_area), '')::DOUBLE PRECISION AS total_area,
    NULLIF(BTRIM(s.planning_land_type), '') AS planning_land_type,
    NULLIF(BTRIM(s.province), '') AS province,
    NULLIF(BTRIM(s.province_code), '') AS province_code,
    NULLIF(BTRIM(s.district), '') AS district,
    NULLIF(BTRIM(s.district_code), '') AS district_code,
    NULLIF(BTRIM(s.ward), '') AS ward,
    NULLIF(BTRIM(s.ward_code), '') AS ward_code,
    NULLIF(BTRIM(s.property_uuid), '') AS property_uuid,
    s.geometry_json::JSONB AS geometry_json,
    ROW_NUMBER() OVER (
      PARTITION BY NULLIF(BTRIM(s.shape_file_id), '')
      ORDER BY
        CASE
          WHEN NULLIF(BTRIM(s.geometry_json), '') IS NOT NULL
           AND (s.geometry_json::jsonb->'coordinates'->0->0->0->>1)::double precision BETWEEN 8.0 AND 23.5
           AND (s.geometry_json::jsonb->'coordinates'->0->0->0->>0)::double precision BETWEEN 102.0 AND 110.0
          THEN 0
          ELSE 1
        END,
        CASE
          WHEN NULLIF(BTRIM(s.geometry_json), '') IS NOT NULL
           AND NULLIF(BTRIM(s.latitude), '') IS NOT NULL
           AND NULLIF(BTRIM(s.longitude), '') IS NOT NULL
           AND ABS((s.geometry_json::jsonb->'coordinates'->0->0->0->>1)::double precision - NULLIF(BTRIM(s.latitude), '')::double precision) <= 0.01
           AND ABS((s.geometry_json::jsonb->'coordinates'->0->0->0->>0)::double precision - NULLIF(BTRIM(s.longitude), '')::double precision) <= 0.01
          THEN 0
          ELSE 1
        END,
        s.ctid DESC
    ) AS rn
  FROM land_parcels_staging s
  WHERE NULLIF(BTRIM(s.latitude), '') IS NOT NULL
    AND NULLIF(BTRIM(s.longitude), '') IS NOT NULL
    AND NULLIF(BTRIM(s.geometry_json), '') IS NOT NULL
    AND NULLIF(BTRIM(s.shape_file_id), '') IS NOT NULL
    AND NULLIF(BTRIM(s.province_code), '') = '79'
    AND s.geometry_json::JSONB ->> 'type' = 'MultiPolygon'
) ranked
WHERE rn = 1;

DROP TABLE land_parcels_staging;

\echo 'Creating indexes...'
CREATE INDEX land_parcels_lat_lng_idx ON land_parcels (latitude, longitude);
CREATE INDEX land_parcels_property_code_idx ON land_parcels (property_code);
CREATE INDEX land_parcels_property_uuid_idx ON land_parcels (property_uuid);
CREATE INDEX land_parcels_admin_idx ON land_parcels (district, ward);
CREATE INDEX land_parcels_land_type_idx ON land_parcels (planning_land_type);
CREATE INDEX land_parcels_total_area_idx ON land_parcels (total_area);
CREATE INDEX land_parcels_shape_file_id_idx ON land_parcels (shape_file_id);
CREATE INDEX land_parcels_province_code_idx ON land_parcels (province_code);

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
