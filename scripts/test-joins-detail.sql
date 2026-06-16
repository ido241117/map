\timing on

\echo '=== Sample method 9 (district+ward+street+address) ==='
SELECT pbr.record_id, pbr.address, pbr.street, pbr.ward, pbr.district,
       lp.id AS parcel_id, lp.shape_file_id, LEFT(lp.address, 80) AS lp_address
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE '%' || pbr.street || '%'
 AND lp.address ILIKE '%' || pbr.address || '%'
LIMIT 20;

\echo '=== Sample method 7 (street+address in lp.address) - top matches per pbr ==='
SELECT pbr.record_id, pbr.address, pbr.street, COUNT(*) AS parcel_matches
FROM property_buy_records pbr
JOIN land_parcels lp
  ON lp.address ILIKE '%' || pbr.street || '%'
 AND lp.address ILIKE '%' || pbr.address || '%'
GROUP BY pbr.id, pbr.record_id, pbr.address, pbr.street
ORDER BY parcel_matches DESC, pbr.record_id
LIMIT 20;

\echo '=== Method 7: how many pbr have exactly 1 match ==='
WITH m AS (
  SELECT pbr.id, COUNT(*) AS c
  FROM property_buy_records pbr
  JOIN land_parcels lp
    ON lp.address ILIKE '%' || pbr.street || '%'
   AND lp.address ILIKE '%' || pbr.address || '%'
  GROUP BY pbr.id
)
SELECT c AS matches_per_record, COUNT(*) AS num_records
FROM m GROUP BY c ORDER BY c;

\echo '=== Method 9 refined: add Số prefix for address ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE '%' || pbr.street || '%'
 AND (
   lp.address ILIKE '%' || pbr.address || '%'
   OR lp.address ILIKE '%Số ' || pbr.address || '%'
   OR lp.address ILIKE '%Số ' || pbr.address || ',%'
 );

\echo '=== Method 9 refined: distinct pbr matched ==='
SELECT COUNT(DISTINCT pbr.id) AS distinct_pbr
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE '%' || pbr.street || '%'
 AND (
   lp.address ILIKE '%' || pbr.address || '%'
   OR lp.address ILIKE '%Số ' || pbr.address || '%'
 );

\echo '=== Normalize: unaccent + lower district/ward ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp
  ON lower(unaccent(REPLACE(pbr.district, 'Q.', 'Q. '))) = lower(unaccent(lp.district))
 AND lower(unaccent(REPLACE(pbr.ward, 'P.', 'P. '))) = lower(unaccent(lp.ward))
 AND lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(pbr.street)) || '%'
 AND lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(pbr.address)) || '%';

\echo '=== Method 12 sample: shape_file_id ends with record_id ==='
SELECT pbr.record_id, lp.shape_file_id, lp.property_code, LEFT(lp.address, 70) AS addr
FROM property_buy_records pbr
JOIN land_parcels lp ON lp.shape_file_id::text LIKE '%' || pbr.record_id::text
LIMIT 15;

\echo '=== Method 11 sample: record_id = suffix of property_code ==='
SELECT pbr.record_id, lp.property_code, LEFT(lp.address, 70) AS addr
FROM property_buy_records pbr
JOIN land_parcels lp ON RIGHT(lp.property_code, LENGTH(pbr.record_id::text)) = pbr.record_id::text;

\echo '=== Try: build full address pattern from pbr fields ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp
  ON lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(pbr.address)) || '%'
 AND lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(pbr.street)) || '%'
 AND lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(REPLACE(pbr.ward, 'P.', 'P. '))) || '%'
 AND lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(REPLACE(pbr.district, 'Q.', 'Q. '))) || '%';

\echo '=== Full pattern: distinct pbr + match count distribution ==='
WITH m AS (
  SELECT pbr.id, COUNT(*) AS c
  FROM property_buy_records pbr
  JOIN land_parcels lp
    ON lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(pbr.address)) || '%'
   AND lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(pbr.street)) || '%'
   AND lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(REPLACE(pbr.ward, 'P.', 'P. '))) || '%'
   AND lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(REPLACE(pbr.district, 'Q.', 'Q. '))) || '%'
  GROUP BY pbr.id
)
SELECT c AS matches_per_record, COUNT(*) AS num_records FROM m GROUP BY c ORDER BY c;

\echo '=== Full pattern: records with exactly 1 match ==='
WITH m AS (
  SELECT pbr.id, pbr.record_id, pbr.address, pbr.street, lp.id AS parcel_id, lp.address AS lp_addr,
         COUNT(*) OVER (PARTITION BY pbr.id) AS match_count
  FROM property_buy_records pbr
  JOIN land_parcels lp
    ON lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(pbr.address)) || '%'
   AND lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(pbr.street)) || '%'
   AND lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(REPLACE(pbr.ward, 'P.', 'P. '))) || '%'
   AND lower(unaccent(lp.address)) LIKE '%' || lower(unaccent(REPLACE(pbr.district, 'Q.', 'Q. '))) || '%'
)
SELECT record_id, address, street, parcel_id, LEFT(lp_addr, 90) AS lp_address
FROM m WHERE match_count = 1
ORDER BY record_id
LIMIT 30;
