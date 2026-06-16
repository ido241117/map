\echo '=== pbr records in districts that exist in land_parcels ==='
WITH lp_districts AS (
  SELECT DISTINCT district FROM land_parcels
),
pbr_norm AS (
  SELECT *,
    CASE REPLACE(district, 'Q.', 'Q. ')
      WHEN 'Q. Thủ Đức' THEN 'TP. Thủ Đức'
      ELSE REPLACE(district, 'Q.', 'Q. ')
    END AS district_norm
  FROM property_buy_records
)
SELECT
  COUNT(*) FILTER (WHERE district_norm IN (SELECT district FROM lp_districts)) AS in_overlap,
  COUNT(*) FILTER (WHERE district_norm NOT IN (SELECT district FROM lp_districts)) AS not_in_lp,
  COUNT(*) AS total
FROM pbr_norm;

\echo '=== pbr districts NOT in land_parcels ==='
WITH lp_districts AS (SELECT DISTINCT district FROM land_parcels),
pbr_norm AS (
  SELECT district,
    CASE REPLACE(district, 'Q.', 'Q. ')
      WHEN 'Q. Thủ Đức' THEN 'TP. Thủ Đức'
      ELSE REPLACE(district, 'Q.', 'Q. ')
    END AS district_norm,
    COUNT(*) AS cnt
  FROM property_buy_records
  GROUP BY district
)
SELECT district, district_norm, cnt
FROM pbr_norm
WHERE district_norm NOT IN (SELECT district FROM lp_districts)
ORDER BY cnt DESC;
