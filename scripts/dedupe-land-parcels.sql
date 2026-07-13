\set ON_ERROR_STOP on
\timing on

\echo '=== Before dedupe ==='
SELECT
  COUNT(*)::bigint AS total_rows,
  COUNT(DISTINCT shape_file_id)::bigint AS unique_shape_file_ids,
  COUNT(*)::bigint - COUNT(DISTINCT shape_file_id)::bigint AS duplicate_shape_file_ids
FROM land_parcels;

\echo '=== Duplicate groups by center lat/lng + MultiPolygon ==='
SELECT
  COUNT(*)::int AS duplicate_groups,
  COALESCE(SUM(cnt - 1), 0)::bigint AS rows_to_remove
FROM (
  SELECT COUNT(*) AS cnt
  FROM land_parcels
  WHERE geometry_json IS NOT NULL
    AND geometry_json->>'type' = 'MultiPolygon'
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
  GROUP BY
    ROUND(latitude::numeric, 6),
    ROUND(longitude::numeric, 6),
    md5(geometry_json::text)
  HAVING COUNT(*) > 1
) d;

\echo '=== Deleting duplicate rows (keep best per shape_file_id) ==='
DELETE FROM land_parcels lp
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY shape_file_id
        ORDER BY
          CASE
            WHEN geometry_json IS NOT NULL
             AND (geometry_json->'coordinates'->0->0->0->>1)::double precision BETWEEN 8.0 AND 23.5
             AND (geometry_json->'coordinates'->0->0->0->>0)::double precision BETWEEN 102.0 AND 110.0
            THEN 0
            ELSE 1
          END,
          CASE
            WHEN geometry_json IS NOT NULL
             AND ABS((geometry_json->'coordinates'->0->0->0->>1)::double precision - latitude) <= 0.01
             AND ABS((geometry_json->'coordinates'->0->0->0->>0)::double precision - longitude) <= 0.01
            THEN 0
            ELSE 1
          END,
          CASE
            WHEN latitude BETWEEN 8.0 AND 23.5
             AND longitude BETWEEN 102.0 AND 110.0
            THEN 0
            ELSE 1
          END,
          id DESC
      ) AS rn
    FROM land_parcels
    WHERE shape_file_id IS NOT NULL
  ) ranked
  WHERE rn > 1
) dup
WHERE lp.id = dup.id;

\echo '=== Deleting duplicate rows (keep best per center lat/lng + MultiPolygon) ==='
DELETE FROM land_parcels lp
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          ROUND(latitude::numeric, 6),
          ROUND(longitude::numeric, 6),
          md5(geometry_json::text)
        ORDER BY
          CASE
            WHEN NULLIF(BTRIM(property_code), '') IS NOT NULL
             AND property_code <> '0'
            THEN 0
            ELSE 1
          END,
          CASE
            WHEN NULLIF(BTRIM(address), '') IS NOT NULL
             AND address NOT LIKE ',%'
            THEN 0
            ELSE 1
          END,
          shape_file_id DESC NULLS LAST,
          id DESC
      ) AS rn
    FROM land_parcels
    WHERE geometry_json IS NOT NULL
      AND geometry_json->>'type' = 'MultiPolygon'
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
  ) ranked
  WHERE rn > 1
) dup
WHERE lp.id = dup.id;

\echo '=== After dedupe ==='
SELECT
  COUNT(*)::bigint AS total_rows,
  COUNT(DISTINCT shape_file_id)::bigint AS unique_shape_file_ids,
  COUNT(*)::bigint - COUNT(DISTINCT shape_file_id)::bigint AS duplicate_shape_file_ids
FROM land_parcels;

\echo '=== Remaining duplicate center lat/lng + MultiPolygon (should be 0) ==='
SELECT COUNT(*)::int AS duplicate_groups
FROM (
  SELECT 1
  FROM land_parcels
  WHERE geometry_json IS NOT NULL
    AND geometry_json->>'type' = 'MultiPolygon'
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
  GROUP BY
    ROUND(latitude::numeric, 6),
    ROUND(longitude::numeric, 6),
    md5(geometry_json::text)
  HAVING COUNT(*) > 1
) d;

\echo '=== Remaining duplicate shape_file_id (should be 0) ==='
SELECT COUNT(*)::int AS ids_with_duplicates
FROM (
  SELECT shape_file_id
  FROM land_parcels
  GROUP BY shape_file_id
  HAVING COUNT(*) > 1
) d;

\echo '=== Replace non-unique shape_file_id index with UNIQUE ==='
DROP INDEX IF EXISTS land_parcels_shape_file_id_idx;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS land_parcels_shape_file_id_uniq
  ON land_parcels (shape_file_id);

ANALYZE land_parcels;

INSERT INTO db_meta (key, value, updated_at)
VALUES
  ('dedupe_at', now()::text, now()),
  ('dedupe_rule', 'shape_file_id_then_lat_lng_geometry', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

INSERT INTO db_meta (key, value, updated_at)
SELECT 'row_count', COUNT(*)::text, now()
FROM land_parcels
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

\echo '=== Dedupe complete ==='
