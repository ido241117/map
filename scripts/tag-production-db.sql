\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS db_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO db_meta (key, value, updated_at)
VALUES
  ('dataset', 'hcm_land_full', now()),
  ('source_csv', 'scan/crawler/data/hcm_land_data.csv', now()),
  ('import_mode', 'full', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

INSERT INTO db_meta (key, value, updated_at)
SELECT 'row_count', COUNT(*)::text, now()
FROM land_parcels
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

SELECT key, value, updated_at FROM db_meta ORDER BY key;
