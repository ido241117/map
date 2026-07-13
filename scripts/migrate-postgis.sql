-- Phase 1.1: PostGIS schema migration (pilot)
-- Scope: land_parcels (TP. Hồ Chí Minh only) + hcm_qhsdd (full table)
-- Requires: PostGIS extension on the same PostgreSQL instance as hcm_land_mvp
--
-- Run via: npm run db:migrate-postgis
-- Or:      psql -U postgres -h localhost -p 5432 -d hcm_land_mvp -f scripts/migrate-postgis.sql
--
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction.
--       Use migrate-postgis.js for the full pipeline (batch UPDATE + indexes).

\set ON_ERROR_STOP on
\timing on

\echo '=== Phase 1.1: enable PostGIS ==='
CREATE EXTENSION IF NOT EXISTS postgis;

\echo '=== land_parcels: add geom column ==='
ALTER TABLE land_parcels
  ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);

\echo '=== hcm_qhsdd: add geom column ==='
ALTER TABLE hcm_qhsdd
  ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);

\echo 'SQL setup done. Run migrate-postgis.js to populate geom in batches and create GIST indexes.'
