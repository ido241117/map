\set ON_ERROR_STOP on
\timing on

DROP TABLE IF EXISTS hcm_qhsdd_staging;
DROP TABLE IF EXISTS hcm_qhsdd;

CREATE TABLE hcm_qhsdd_staging (
  feature_id TEXT,
  loai_dat_quy_hoach TEXT,
  center_lat TEXT,
  center_long TEXT,
  red TEXT,
  green TEXT,
  blue TEXT,
  color TEXT,
  fill_hex TEXT,
  geometry_type TEXT,
  tile_key TEXT,
  geometry_json TEXT
);

\echo 'Copying CSV into staging table...'
\copy hcm_qhsdd_staging FROM '__CSV_PATH__' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

\echo 'Creating hcm_qhsdd table...'
CREATE TABLE hcm_qhsdd (
  id SERIAL PRIMARY KEY,
  feature_id TEXT NOT NULL UNIQUE,
  loai_dat_quy_hoach TEXT,
  center_lat DOUBLE PRECISION NOT NULL,
  center_long DOUBLE PRECISION NOT NULL,
  red SMALLINT,
  green SMALLINT,
  blue SMALLINT,
  color TEXT,
  fill_hex TEXT,
  geometry_type TEXT,
  geometry_json JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

\echo 'Inserting valid rows from staging...'
INSERT INTO hcm_qhsdd (
  feature_id,
  loai_dat_quy_hoach,
  center_lat,
  center_long,
  red,
  green,
  blue,
  color,
  fill_hex,
  geometry_type,
  geometry_json
)
SELECT
  NULLIF(BTRIM(feature_id), ''),
  NULLIF(BTRIM(loai_dat_quy_hoach), ''),
  NULLIF(BTRIM(center_lat), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(center_long), '')::DOUBLE PRECISION,
  NULLIF(BTRIM(red), '')::SMALLINT,
  NULLIF(BTRIM(green), '')::SMALLINT,
  NULLIF(BTRIM(blue), '')::SMALLINT,
  NULLIF(BTRIM(color), ''),
  NULLIF(BTRIM(fill_hex), ''),
  NULLIF(BTRIM(geometry_type), ''),
  geometry_json::JSONB
FROM hcm_qhsdd_staging
WHERE NULLIF(BTRIM(feature_id), '') IS NOT NULL
  AND NULLIF(BTRIM(center_lat), '') IS NOT NULL
  AND NULLIF(BTRIM(center_long), '') IS NOT NULL
  AND NULLIF(BTRIM(geometry_json), '') IS NOT NULL;

DROP TABLE hcm_qhsdd_staging;

\echo 'Creating indexes...'
CREATE INDEX hcm_qhsdd_center_idx ON hcm_qhsdd (center_lat, center_long);
CREATE INDEX hcm_qhsdd_land_type_idx ON hcm_qhsdd (loai_dat_quy_hoach);

INSERT INTO db_meta (key, value, updated_at)
VALUES
  ('hcm_qhsdd_source', 'hcm_qhsdd_data.csv', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

INSERT INTO db_meta (key, value, updated_at)
SELECT 'hcm_qhsdd_row_count', COUNT(*)::text, now()
FROM hcm_qhsdd
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

\echo 'Import summary:'
SELECT COUNT(*) AS imported_rows FROM hcm_qhsdd;
