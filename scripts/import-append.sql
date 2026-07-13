\set ON_ERROR_STOP on
\timing on

DROP TABLE IF EXISTS land_parcels_staging;

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

\echo 'Staging rows (raw):'
SELECT COUNT(*) AS staging_rows FROM land_parcels_staging;

\echo 'Deduping staging (one row per shape_file_id, prefer HCM geometry)...'
CREATE TEMP TABLE land_parcels_staging_deduped AS
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
    s.*,
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
        CASE
          WHEN NULLIF(BTRIM(s.latitude), '')::double precision BETWEEN 8.0 AND 23.5
           AND NULLIF(BTRIM(s.longitude), '')::double precision BETWEEN 102.0 AND 110.0
          THEN 0
          ELSE 1
        END,
        s.ctid DESC
    ) AS rn
  FROM land_parcels_staging s
  WHERE NULLIF(BTRIM(s.shape_file_id), '') IS NOT NULL
) ranked
WHERE rn = 1;

DROP TABLE land_parcels_staging;
ALTER TABLE land_parcels_staging_deduped RENAME TO land_parcels_staging;

\echo 'Staging rows (deduped):'
SELECT COUNT(*) AS staging_rows FROM land_parcels_staging;

\echo 'Inserting rows not yet in land_parcels (by shape_file_id)...'
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
  s.shape_file_id::BIGINT,
  NULLIF(BTRIM(s.property_code), ''),
  NULLIF(BTRIM(s.address), ''),
  NULLIF(BTRIM(s.latitude), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(s.longitude), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(s.total_area), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(s.planning_land_type), ''),
  NULLIF(BTRIM(s.province), ''),
  NULLIF(BTRIM(s.province_code), ''),
  NULLIF(BTRIM(s.district), ''),
  NULLIF(BTRIM(s.district_code), ''),
  NULLIF(BTRIM(s.ward), ''),
  NULLIF(BTRIM(s.ward_code), ''),
  NULLIF(BTRIM(s.property_uuid), ''),
  s.geometry_json::JSONB
FROM land_parcels_staging s
WHERE NULLIF(BTRIM(s.latitude), '') IS NOT NULL
  AND NULLIF(BTRIM(s.longitude), '') IS NOT NULL
  AND NULLIF(BTRIM(s.geometry_json), '') IS NOT NULL
  AND NULLIF(BTRIM(s.shape_file_id), '') IS NOT NULL
  AND s.geometry_json::JSONB ->> 'type' = 'MultiPolygon'
  AND NOT EXISTS (
    SELECT 1
    FROM land_parcels lp
    WHERE lp.shape_file_id = NULLIF(BTRIM(s.shape_file_id), '')::BIGINT
  );

DROP TABLE land_parcels_staging;

ANALYZE land_parcels;

INSERT INTO db_meta (key, value, updated_at)
VALUES
  ('source_csv', '__SOURCE_CSV__', now()),
  ('import_mode', 'append', now()),
  ('last_append_at', now()::text, now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

INSERT INTO db_meta (key, value, updated_at)
SELECT 'row_count', COUNT(*)::text, now()
FROM land_parcels
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

\echo 'Append summary:'
SELECT COUNT(*) AS total_rows FROM land_parcels;
