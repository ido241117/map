ALTER TABLE hcm_qhsdd
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS ward text,
  ADD COLUMN IF NOT EXISTS admin_match text;

CREATE INDEX IF NOT EXISTS hcm_qhsdd_district_idx ON hcm_qhsdd (district);
CREATE INDEX IF NOT EXISTS hcm_qhsdd_district_ward_idx ON hcm_qhsdd (district, ward);
