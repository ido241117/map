SELECT district, COUNT(*) AS cnt FROM property_buy_records GROUP BY district ORDER BY cnt DESC;
SELECT district, COUNT(*) AS cnt FROM land_parcels GROUP BY district ORDER BY cnt DESC;
