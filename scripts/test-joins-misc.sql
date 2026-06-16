\echo '=== Ward Phu Tho variants in land_parcels ==='
SELECT DISTINCT ward, district FROM land_parcels
WHERE district ILIKE '%Tân Phú%' AND ward ILIKE '%Phú%Thọ%'
ORDER BY ward;

\echo '=== record 233565: parcels with Nguyen Son in Tan Phu ==='
SELECT COUNT(*) AS cnt FROM land_parcels lp
WHERE lp.district = 'Q. Tân Phú' AND lp.address ILIKE '%Nguyễn Sơn%';

\echo '=== Format differences pbr vs lp ==='
SELECT 'pbr' AS src, district, ward FROM property_buy_records LIMIT 3
UNION ALL
SELECT 'lp', district, ward FROM land_parcels LIMIT 3;
