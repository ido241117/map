\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS postgis;

DROP TABLE IF EXISTS land_parcels CASCADE;
DROP TABLE IF EXISTS hcm_qhsdd CASCADE;

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

CREATE TABLE IF NOT EXISTS db_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO db_meta (key, value, updated_at)
VALUES
  ('dataset', 'hcm_land_docker_mvp', now()),
  ('scope', 'land_parcels province_code=79 + hcm_qhsdd', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;
