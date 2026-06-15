-- Performance indexes for 300k+ parcel dataset
-- Run: psql $DATABASE_URL -f scripts/add-performance-indexes.sql
-- Note: land_parcels_lat_lng_idx (latitude, longitude) is created by import-full.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS land_parcels_total_area_idx
  ON land_parcels (total_area);

-- Speed up lookup by property_uuid
CREATE INDEX CONCURRENTLY IF NOT EXISTS land_parcels_property_uuid_idx
  ON land_parcels (property_uuid);

ANALYZE land_parcels;
