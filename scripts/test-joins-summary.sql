\timing on

\echo '=== Ngõ/Hẻm pattern: Số X, Ngõ {address} ==='
SELECT COUNT(DISTINCT pbr.id) AS distinct_pbr
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND (
   lp.address ILIKE '%Ngõ ' || pbr.address || ', ' || pbr.street || '%'
   OR lp.address ILIKE '%Ngõ ' || pbr.address || '/' || '%' || pbr.street || '%'
   OR lp.address ILIKE '%Hẻm ' || pbr.address || '%' || pbr.street || '%'
 );

\echo '=== Sample Ngõ matches ==='
SELECT pbr.record_id, pbr.address, pbr.street, LEFT(lp.address, 95) AS lp_address
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND REPLACE(pbr.ward, 'P.', 'P. ') = lp.ward
 AND lp.address ILIKE '%Ngõ ' || pbr.address || '%' || pbr.street || '%'
LIMIT 10;

\echo '=== Ward fuzzy: ignore accents/spaces (translate) ==='
SELECT COUNT(DISTINCT pbr.id) AS distinct_pbr
FROM property_buy_records pbr
JOIN land_parcels lp
  ON REPLACE(pbr.district, 'Q.', 'Q. ') = lp.district
 AND translate(REPLACE(pbr.ward, 'P.', 'P. '), 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')
   = translate(lp.ward, 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')
 AND lp.address ILIKE 'Số ' || pbr.address || ', ' || pbr.street || '%';

\echo '=== property_code suffix: verify address quality ==='
SELECT pbr.record_id, pbr.address, pbr.street, pbr.ward, pbr.district,
       lp.property_code, LEFT(lp.address, 90) AS lp_address
FROM property_buy_records pbr
JOIN land_parcels lp ON RIGHT(lp.property_code, LENGTH(pbr.record_id::text)) = pbr.record_id::text;

\echo '=== SUMMARY: all methods distinct pbr matched ==='
SELECT method, matched_pbr, total_pbr, ROUND(100.0 * matched_pbr / total_pbr, 1) AS pct
FROM (
  SELECT 'shape_file_id=4000000+record_id (WRONG data!)' AS method,
         COUNT(DISTINCT pbr.id) AS matched_pbr, (SELECT COUNT(*) FROM property_buy_records) AS total_pbr
  FROM property_buy_records pbr
  JOIN land_parcels lp ON lp.shape_file_id = 4000000 + pbr.record_id
  UNION ALL
  SELECT 'district+ward exact', COUNT(DISTINCT pbr.id), (SELECT COUNT(*) FROM property_buy_records)
  FROM property_buy_records pbr JOIN land_parcels lp ON pbr.district=lp.district AND pbr.ward=lp.ward
  UNION ALL
  SELECT 'district+ward normalized', COUNT(DISTINCT pbr.id), (SELECT COUNT(*) FROM property_buy_records)
  FROM property_buy_records pbr JOIN land_parcels lp
    ON REPLACE(pbr.district,'Q.','Q. ')=lp.district AND REPLACE(pbr.ward,'P.','P. ')=lp.ward
  UNION ALL
  SELECT 'So address + street + admin (unique 1:1)', COUNT(*), (SELECT COUNT(*) FROM property_buy_records)
  FROM (
    SELECT pbr.id FROM property_buy_records pbr JOIN land_parcels lp
      ON REPLACE(pbr.district,'Q.','Q. ')=lp.district AND REPLACE(pbr.ward,'P.','P. ')=lp.ward
     AND lp.address ILIKE 'Số '||pbr.address||', '||pbr.street||'%'
    GROUP BY pbr.id HAVING COUNT(*)=1
  ) t
  UNION ALL
  SELECT 'street+address fuzzy in lp.address', COUNT(DISTINCT pbr.id), (SELECT COUNT(*) FROM property_buy_records)
  FROM property_buy_records pbr JOIN land_parcels lp
    ON lp.address ILIKE '%'||pbr.street||'%' AND lp.address ILIKE '%'||pbr.address||'%'
  UNION ALL
  SELECT 'admin+street+address fuzzy', COUNT(DISTINCT pbr.id), (SELECT COUNT(*) FROM property_buy_records)
  FROM property_buy_records pbr JOIN land_parcels lp
    ON REPLACE(pbr.district,'Q.','Q. ')=lp.district AND REPLACE(pbr.ward,'P.','P. ')=lp.ward
   AND lp.address ILIKE '%'||pbr.street||'%' AND lp.address ILIKE '%'||pbr.address||'%'
  UNION ALL
  SELECT 'property_code suffix=record_id', COUNT(DISTINCT pbr.id), (SELECT COUNT(*) FROM property_buy_records)
  FROM property_buy_records pbr JOIN land_parcels lp
    ON RIGHT(lp.property_code, LENGTH(pbr.record_id::text)) = pbr.record_id::text
) s ORDER BY matched_pbr DESC;
