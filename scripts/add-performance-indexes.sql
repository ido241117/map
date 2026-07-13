-- Performance indexes for 1M+ parcel dataset
-- Run: psql $DATABASE_URL -f scripts/add-performance-indexes.sql
-- Note: land_parcels_lat_lng_idx (latitude, longitude) is created by import-full.sql
-- Note: land_parcels_shape_file_id_uniq is created by dedupe-land-parcels.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS land_parcels_total_area_idx
  ON land_parcels (total_area);

CREATE INDEX CONCURRENTLY IF NOT EXISTS land_parcels_property_uuid_idx
  ON land_parcels (property_uuid);

CREATE INDEX CONCURRENTLY IF NOT EXISTS land_parcels_district_idx
  ON land_parcels (district);

CREATE INDEX CONCURRENTLY IF NOT EXISTS land_parcels_ward_idx
  ON land_parcels (ward);

CREATE INDEX CONCURRENTLY IF NOT EXISTS land_parcels_planning_land_type_idx
  ON land_parcels (planning_land_type);

ANALYZE land_parcels;
