export const PARCEL_SOURCES = ['land_parcels'] as const;

export type ParcelSource = (typeof PARCEL_SOURCES)[number];

export function parseParcelSource(_value?: string): ParcelSource {
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
};

export function geometryColumnForSource(_source: ParcelSource) {
  return ', geometry_json';
}
