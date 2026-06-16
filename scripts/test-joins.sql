\timing on

\echo '=== COUNTS ==='
SELECT 'land_parcels' AS tbl, COUNT(*) FROM land_parcels
UNION ALL SELECT 'property_buy_records', COUNT(*) FROM property_buy_records;

\echo '=== 1) record_id = shape_file_id ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp ON pbr.record_id = lp.shape_file_id;

\echo '=== 2) record_id in property_code ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp ON lp.property_code LIKE '%' || pbr.record_id::text || '%';

\echo '=== 3) district + ward exact ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp ON pbr.district = lp.district AND pbr.ward = lp.ward;

\echo '=== 4) district + ward normalized (P./Q. spacing) ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward;

\echo '=== 5) address exact ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp ON pbr.address = lp.address;

\echo '=== 6) lp.address contains pbr.address ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp ON lp.address ILIKE '%' || pbr.address || '%';

\echo '=== 7) lp.address contains street + address ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp
  ON lp.address ILIKE '%' || pbr.street || '%'
 AND lp.address ILIKE '%' || pbr.address || '%';

\echo '=== 8) district+ward normalized + street in address ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE '%' || pbr.street || '%';

\echo '=== 9) district+ward normalized + street + address in lp.address ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE '%' || pbr.street || '%'
 AND lp.address ILIKE '%' || pbr.address || '%';

\echo '=== 10) DISTINCT pbr rows matched by method 9 ==='
SELECT COUNT(DISTINCT pbr.id) AS distinct_pbr_matched
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE '%' || pbr.street || '%'
 AND lp.address ILIKE '%' || pbr.address || '%';

\echo '=== 11) record_id = last digits of property_code ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp ON RIGHT(lp.property_code, LENGTH(pbr.record_id::text)) = pbr.record_id::text;

\echo '=== 12) shape_file_id ends with record_id ==='
SELECT COUNT(*) AS matches
FROM property_buy_records pbr
JOIN land_parcels lp ON lp.shape_file_id::text LIKE '%' || pbr.record_id::text;
