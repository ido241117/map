\set ON_ERROR_STOP on

CREATE INDEX IF NOT EXISTS land_parcels_lat_lng_idx ON land_parcels (latitude, longitude);
CREATE INDEX IF NOT EXISTS land_parcels_property_code_idx ON land_parcels (property_code);
CREATE INDEX IF NOT EXISTS land_parcels_property_uuid_idx ON land_parcels (property_uuid);
CREATE INDEX IF NOT EXISTS land_parcels_admin_idx ON land_parcels (district, ward);
CREATE INDEX IF NOT EXISTS land_parcels_land_type_idx ON land_parcels (planning_land_type);
CREATE INDEX IF NOT EXISTS land_parcels_total_area_idx ON land_parcels (total_area);
CREATE UNIQUE INDEX IF NOT EXISTS land_parcels_shape_file_id_uniq ON land_parcels (shape_file_id);

CREATE INDEX IF NOT EXISTS hcm_qhsdd_center_idx ON hcm_qhsdd (center_lat, center_long);
CREATE INDEX IF NOT EXISTS hcm_qhsdd_land_type_idx ON hcm_qhsdd (loai_dat_quy_hoach);

ANALYZE land_parcels;
ANALYZE hcm_qhsdd;
