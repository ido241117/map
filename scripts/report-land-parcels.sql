\set ON_ERROR_STOP on

\echo '=== land_parcels overview ==='
SELECT COUNT(*) AS total_rows FROM land_parcels;
SELECT COUNT(DISTINCT shape_file_id) AS unique_shape_file_ids FROM land_parcels;

\echo '=== duplicate shape_file_id ==='
SELECT COUNT(*) AS ids_with_duplicates
FROM (
  SELECT shape_file_id FROM land_parcels
  GROUP BY shape_file_id HAVING COUNT(*) > 1
) d;

\echo '=== geometry type breakdown ==='
SELECT geometry_json->>'type' AS geom_type, COUNT(*) AS cnt
FROM land_parcels
GROUP BY 1 ORDER BY cnt DESC;

\echo '=== rows missing geometry ==='
SELECT COUNT(*) AS no_geometry
FROM land_parcels
WHERE geometry_json IS NULL;

\echo '=== rows missing lat/lng ==='
SELECT COUNT(*) AS no_coords
FROM land_parcels
WHERE latitude IS NULL OR longitude IS NULL;

\echo '=== metadata completeness ==='
SELECT
  COUNT(*) FILTER (WHERE address IS NULL OR BTRIM(address) = '') AS missing_address,
  COUNT(*) FILTER (WHERE district IS NULL OR BTRIM(district) = '') AS missing_district,
  COUNT(*) FILTER (WHERE ward IS NULL OR BTRIM(ward) = '') AS missing_ward,
  COUNT(*) FILTER (WHERE total_area IS NULL) AS missing_area,
  COUNT(*) FILTER (WHERE planning_land_type IS NULL OR BTRIM(planning_land_type) = '') AS missing_land_type
FROM land_parcels;

\echo '=== area stats ==='
SELECT
  ROUND(MIN(total_area)::numeric, 2) AS min_area_m2,
  ROUND(AVG(total_area)::numeric, 2) AS avg_area_m2,
  ROUND(MAX(total_area)::numeric, 2) AS max_area_m2,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_area)::numeric, 2) AS median_area_m2
FROM land_parcels
WHERE total_area IS NOT NULL;

\echo '=== top 15 districts ==='
SELECT district, COUNT(*) AS cnt
FROM land_parcels
WHERE district IS NOT NULL AND BTRIM(district) <> ''
GROUP BY district ORDER BY cnt DESC LIMIT 15;

\echo '=== top 10 land types ==='
SELECT planning_land_type, COUNT(*) AS cnt
FROM land_parcels
WHERE planning_land_type IS NOT NULL AND BTRIM(planning_land_type) <> ''
GROUP BY planning_land_type ORDER BY cnt DESC LIMIT 10;

\echo '=== db_meta ==='
SELECT key, value, updated_at FROM db_meta ORDER BY key;

\echo '=== 15 missing backfill ids in DB? ==='
SELECT shape_file_id, latitude, longitude,
       geometry_json->>'type' AS geom_type,
       LEFT(address, 60) AS address
FROM land_parcels
WHERE shape_file_id IN (
  2251724, 2251732, 2251736, 2252675, 2252695,
  2252746, 2252886, 2252897, 2252939, 2253064,
  2253065, 2253070, 2253071, 2253072, 2253073
)
ORDER BY shape_file_id;

\echo '=== suspicious geometry (centroid far from lat/lng) sample ==='
SELECT COUNT(*) AS suspicious_geom_rows
FROM land_parcels
WHERE geometry_json IS NOT NULL
  AND geometry_json->>'type' = 'MultiPolygon'
  AND latitude IS NOT NULL AND longitude IS NOT NULL
  AND (
    ABS(
      (geometry_json->'coordinates'->0->0->0->>1)::float - latitude
    ) > 0.05
    OR ABS(
      (geometry_json->'coordinates'->0->0->0->>0)::float - longitude
    ) > 0.05
  );
