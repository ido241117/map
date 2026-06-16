export const PARCEL_SOURCES = ['land_parcels', 'guland_hcm_land'] as const;

export type ParcelSource = (typeof PARCEL_SOURCES)[number];

export function parseParcelSource(value?: string): ParcelSource {
  if (value === 'guland_hcm_land') return 'guland_hcm_land';
  return 'land_parcels';
}

type SourceSql = {
  table: string;
  selectColumns: string;
  searchClause: string;
  districtColumn: string;
  wardColumn: string;
  landTypeColumn: string;
  statsDistrictSql: string;
  statsWardSql: string;
  statsLandTypeSql: string;
};

export const SOURCE_SQL: Record<ParcelSource, SourceSql> = {
  land_parcels: {
    table: 'land_parcels',
    selectColumns: `
      id,
      shape_file_id,
      property_code,
      address,
      latitude,
      longitude,
      total_area,
      planning_land_type,
      province,
      district,
      ward,
      property_uuid`,
    searchClause:
      '(address ILIKE $SEARCH OR property_code ILIKE $SEARCH OR property_uuid ILIKE $SEARCH)',
    districtColumn: 'district',
    wardColumn: 'ward',
    landTypeColumn: 'planning_land_type',
    statsDistrictSql: `
      SELECT district, COUNT(*)::int AS count
      FROM land_parcels
      GROUP BY district
      ORDER BY count DESC, district`,
    statsWardSql: `
      SELECT district, ward, COUNT(*)::int AS count
      FROM land_parcels
      GROUP BY district, ward
      ORDER BY district, ward`,
    statsLandTypeSql: `
      SELECT planning_land_type, COUNT(*)::int AS count
      FROM land_parcels
      GROUP BY planning_land_type
      ORDER BY count DESC, planning_land_type`,
  },
  guland_hcm_land: {
    table: 'guland_hcm_land',
    selectColumns: `
      id,
      parcel_id AS shape_file_id,
      parcel_id::text AS property_code,
      address,
      latitude,
      longitude,
      total_area,
      COALESCE(
        land_uses_json->0->>'description',
        land_uses_json->0->>'code',
        ''
      ) AS planning_land_type,
      NULL::text AS province,
      NULLIF(BTRIM(SPLIT_PART(location_old, '|', 2)), '') AS district,
      location_new AS ward,
      parcel_id::text AS property_uuid`,
    searchClause: `(
      address ILIKE $SEARCH
      OR parcel_id::text ILIKE $SEARCH
      OR location_new ILIKE $SEARCH
      OR location_old ILIKE $SEARCH
      OR sheet ILIKE $SEARCH
      OR plot ILIKE $SEARCH
    )`,
    districtColumn: `NULLIF(BTRIM(SPLIT_PART(location_old, '|', 2)), '')`,
    wardColumn: 'location_new',
    landTypeColumn: `COALESCE(land_uses_json->0->>'code', land_uses_json->0->>'description')`,
    statsDistrictSql: `
      SELECT NULLIF(BTRIM(SPLIT_PART(location_old, '|', 2)), '') AS district, COUNT(*)::int AS count
      FROM guland_hcm_land
      WHERE location_old IS NOT NULL AND BTRIM(location_old) <> ''
      GROUP BY 1
      HAVING NULLIF(BTRIM(SPLIT_PART(location_old, '|', 2)), '') IS NOT NULL
      ORDER BY count DESC, district`,
    statsWardSql: `
      SELECT
        NULLIF(BTRIM(SPLIT_PART(location_old, '|', 2)), '') AS district,
        location_new AS ward,
        COUNT(*)::int AS count
      FROM guland_hcm_land
      WHERE location_new IS NOT NULL AND BTRIM(location_new) <> ''
      GROUP BY 1, 2
      ORDER BY district, ward`,
    statsLandTypeSql: `
      SELECT
        COALESCE(land_uses_json->0->>'code', land_uses_json->0->>'description', 'Khác') AS planning_land_type,
        COUNT(*)::int AS count
      FROM guland_hcm_land
      GROUP BY 1
      ORDER BY count DESC, planning_land_type`,
  },
};

export function geometryColumnForSource(source: ParcelSource) {
  if (source === 'guland_hcm_land') {
    return `, CASE
      WHEN shape_json IS NULL OR shape_json->'geometry' IS NULL THEN NULL
      WHEN shape_json->'geometry'->>'type' = 'Polygon' THEN
        jsonb_build_object(
          'type', 'MultiPolygon',
          'coordinates', jsonb_build_array(shape_json->'geometry'->'coordinates')
        )
      ELSE shape_json->'geometry'
    END AS geometry_json`;
  }

  return ', geometry_json';
}
