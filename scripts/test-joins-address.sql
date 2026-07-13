\timing on

\echo '=== 8 unmatched by shape_file_id formula ==='
SELECT record_id, address, street, ward, district
FROM property_buy_records pbr
WHERE NOT EXISTS (
  SELECT 1 FROM land_parcels lp WHERE lp.shape_file_id = 4000000 + pbr.record_id
);

\echo '=== Join: Số {address}, {street} + district/ward ==='
SELECT COUNT(*) AS matches, COUNT(DISTINCT pbr.id) AS distinct_pbr
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE 'Số ' || pbr.address || ', ' || pbr.street || '%';

\echo '=== Sample Số address, street matches ==='
SELECT pbr.record_id, pbr.address, pbr.street, pbr.ward, pbr.district,
       lp.id, LEFT(lp.address, 95) AS lp_address
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE 'Số ' || pbr.address || ', ' || pbr.street || '%'
ORDER BY pbr.record_id
LIMIT 25;

\echo '=== Distribution: matches per pbr (Số pattern) ==='
WITH m AS (
  SELECT pbr.id, COUNT(*) AS c
  FROM property_buy_records pbr
  JOIN land_parcels lp
    ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
   AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
   AND lp.address ILIKE 'Số ' || pbr.address || ', ' || pbr.street || '%'
  GROUP BY pbr.id
)
SELECT c AS matches_per_record, COUNT(*) AS num_pbr FROM m GROUP BY c ORDER BY c;

\echo '=== Also try: address starts line (no So prefix) ==='
SELECT COUNT(DISTINCT pbr.id) AS distinct_pbr
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND (
   lp.address ILIKE pbr.address || ', ' || pbr.street || '%'
   OR lp.address ILIKE pbr.address || ', ' || pbr.street || ',%'
 );

\echo '=== Sample no-So prefix ==='
SELECT pbr.record_id, pbr.address, pbr.street, LEFT(lp.address, 95) AS lp_address
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE pbr.address || ', ' || pbr.street || '%'
LIMIT 15;

\echo '=== BEST: unique 1:1 address join (So + district + ward) ==='
WITH candidates AS (
  SELECT pbr.id AS pbr_id, pbr.record_id, pbr.address, pbr.street, pbr.ward, pbr.district,
         lp.id AS lp_id, lp.address AS lp_address,
         COUNT(*) OVER (PARTITION BY pbr.id) AS match_count
  FROM property_buy_records pbr
  JOIN land_parcels lp
    ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
   AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
   AND lp.address ILIKE 'Số ' || pbr.address || ', ' || pbr.street || '%'
)
SELECT record_id, address, street, ward, district, lp_id, LEFT(lp_address, 90) AS lp_address
FROM candidates WHERE match_count = 1
ORDER BY record_id;

\echo '=== Compare ID join vs address for same record_id 233566 ==='
SELECT 'id_join' AS src, lp.id, lp.shape_file_id, LEFT(lp.address, 90) AS addr
FROM property_buy_records pbr
JOIN land_parcels lp ON lp.shape_file_id = 4000000 + pbr.record_id
WHERE pbr.record_id = 233566
UNION ALL
SELECT 'addr_join', lp.id, lp.shape_file_id, LEFT(lp.address, 90)
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE 'Số ' || pbr.address || ', ' || pbr.street || '%'
WHERE pbr.record_id = 233566;

\echo '=== Total pbr with at least one address-based match (any method) ==='
SELECT COUNT(DISTINCT pbr.id) AS pbr_with_any_addr_match
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE '%' || pbr.street || '%'
 AND lp.address ILIKE '%' || pbr.address || '%';
