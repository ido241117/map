import { Injectable } from '@nestjs/common';
import { OsmDatabaseService } from '../shared/osm-database.service';

type OsmFilters = {
  q?: string;
  landType?: string;
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  includeGeometry?: boolean;
  limit?: number;
};

const OSM_MAX_LIMIT = 2500;
const OSM_SEARCH_LIMIT = 200;

const FEATURE_TYPE_SQL = `COALESCE(
  CASE WHEN building IS NOT NULL THEN 'building:' || building END,
  CASE WHEN landuse IS NOT NULL THEN 'landuse:' || landuse END,
  CASE WHEN amenity IS NOT NULL THEN 'amenity:' || amenity END,
  CASE WHEN leisure IS NOT NULL THEN 'leisure:' || leisure END,
  CASE WHEN "natural" IS NOT NULL THEN 'natural:' || "natural" END,
  CASE WHEN highway IS NOT NULL THEN 'highway:' || highway END,
  CASE WHEN waterway IS NOT NULL THEN 'waterway:' || waterway END,
  CASE WHEN railway IS NOT NULL THEN 'railway:' || railway END,
  'other'
)`;

const POLYGON_GEOMETRY_SQL = `CASE
  WHEN ST_GeometryType(way) = 'ST_Polygon' THEN
    jsonb_build_object(
      'type', 'MultiPolygon',
      'coordinates', jsonb_build_array((ST_AsGeoJSON(way)::jsonb)->'coordinates')
    )
  ELSE ST_AsGeoJSON(way)::jsonb
END`;

@Injectable()
export class OsmParcelsService {
  constructor(private readonly osmDb: OsmDatabaseService) {}

  async list(filters: OsmFilters) {
    const isSearch = Boolean(filters.q?.trim());
    const limit = Math.min(
      Math.max(filters.limit || (isSearch ? OSM_SEARCH_LIMIT : OSM_MAX_LIMIT), 1),
      isSearch ? OSM_SEARCH_LIMIT : OSM_MAX_LIMIT,
    );
    const includeGeometry = filters.includeGeometry ?? false;

    const params: unknown[] = [];
    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    const where: string[] = [];
    if (isSearch) {
      where.push(`(COALESCE(name, '') ILIKE ${addParam(`%${filters.q!.trim()}%`)} OR osm_id::text ILIKE ${addParam(`%${filters.q!.trim()}%`)})`);
    } else if (
      Number.isFinite(filters.minLat) &&
      Number.isFinite(filters.maxLat) &&
      Number.isFinite(filters.minLng) &&
      Number.isFinite(filters.maxLng)
    ) {
      where.push(
        `way && ST_MakeEnvelope(${addParam(filters.minLng!)}, ${addParam(filters.minLat!)}, ${addParam(filters.maxLng!)}, ${addParam(filters.maxLat!)}, 4326)`,
      );
    }

    if (filters.landType) {
      where.push(`${FEATURE_TYPE_SQL} = ${addParam(filters.landType)}`);
    }

    const polygonWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const lineWhereParts = [...where];
    if (!isSearch) {
      lineWhereParts.push(
        '(highway IS NOT NULL OR waterway IS NOT NULL OR railway IS NOT NULL OR boundary IS NOT NULL)',
      );
    }
    const lineWhere = lineWhereParts.length ? `WHERE ${lineWhereParts.join(' AND ')}` : '';

    const geometrySelect = includeGeometry ? `, ${POLYGON_GEOMETRY_SQL} AS geometry_json` : '';
    const lineGeometrySelect = includeGeometry ? ', ST_AsGeoJSON(way)::jsonb AS geometry_json' : '';

    const limitParam = addParam(limit + 1);

    const { rows } = await this.osmDb.query(
      `
      SELECT * FROM (
        SELECT
          ROW_NUMBER() OVER (ORDER BY
            CASE WHEN building IS NOT NULL THEN 0 WHEN landuse IS NOT NULL THEN 1 ELSE 2 END,
            osm_id
          )::int AS id,
          osm_id AS shape_file_id,
          ('polygon:' || osm_id::text) AS property_code,
          COALESCE(NULLIF(name, ''), 'polygon ' || osm_id::text) AS address,
          ST_Y(ST_PointOnSurface(way)) AS latitude,
          ST_X(ST_PointOnSurface(way)) AS longitude,
          ROUND(ST_Area(way::geography))::float AS total_area,
          ${FEATURE_TYPE_SQL} AS planning_land_type,
          NULL::text AS province,
          NULL::text AS district,
          NULL::text AS ward,
          ('polygon:' || osm_id::text) AS property_uuid
          ${geometrySelect}
        FROM planet_osm_polygon
        ${polygonWhere}

        UNION ALL

        SELECT
          (1000000000 + ROW_NUMBER() OVER (ORDER BY osm_id))::int AS id,
          osm_id AS shape_file_id,
          ('line:' || osm_id::text) AS property_code,
          COALESCE(NULLIF(name, ''), 'line ' || osm_id::text) AS address,
          ST_Y(ST_PointOnSurface(way)) AS latitude,
          ST_X(ST_PointOnSurface(way)) AS longitude,
          NULL::float AS total_area,
          ${FEATURE_TYPE_SQL} AS planning_land_type,
          NULL::text AS province,
          NULL::text AS district,
          NULL::text AS ward,
          ('line:' || osm_id::text) AS property_uuid
          ${lineGeometrySelect}
        FROM planet_osm_line
        ${lineWhere}
      ) features
      ORDER BY id
      LIMIT ${limitParam}
      `,
      params,
    );

    const truncated = rows.length > limit;
    const items = truncated ? rows.slice(0, limit) : rows;

    return { source: 'osm_hcm' as const, items, truncated, returned: items.length };
  }

  async suggest(q: string, limit = 10) {
    const token = `%${q.trim()}%`;
    const { rows } = await this.osmDb.query(
      `
      SELECT
        ROW_NUMBER() OVER (ORDER BY CASE WHEN name IS NOT NULL AND name <> '' THEN 0 ELSE 1 END, osm_id)::int AS id,
        COALESCE(NULLIF(name, ''), 'polygon ' || osm_id::text) AS address,
        COALESCE(NULLIF(name, ''), 'polygon ' || osm_id::text) AS full_address,
        NULL::text AS ward,
        NULL::text AS district,
        NULL::text AS province,
        ('polygon:' || osm_id::text) AS property_code,
        ST_Y(ST_PointOnSurface(way)) AS latitude,
        ST_X(ST_PointOnSurface(way)) AS longitude
      FROM planet_osm_polygon
      WHERE (name ILIKE $1 OR osm_id::text ILIKE $1)
        AND name IS NOT NULL
        AND BTRIM(name) <> ''
      ORDER BY length(name), osm_id
      LIMIT $2
      `,
      [token, limit],
    );

    return rows.map((row) => ({
      ...row,
      source: 'osm_hcm' as const,
      score: 1,
    }));
  }

  async stats() {
    const [summary, landTypes] = await Promise.all([
      this.osmDb.query(`
        SELECT
          (
            (SELECT COUNT(*)::int FROM planet_osm_polygon)
            + (SELECT COUNT(*)::int FROM planet_osm_line)
            + (SELECT COUNT(*)::int FROM planet_osm_point)
          ) AS parcel_count,
          ROUND(AVG(ST_Area(way::geography)))::float AS avg_area,
          ROUND(MIN(ST_Area(way::geography)))::float AS min_area,
          ROUND(MAX(ST_Area(way::geography)))::float AS max_area
        FROM planet_osm_polygon
        WHERE building IS NOT NULL OR landuse IS NOT NULL
      `),
      this.osmDb.query(`
        SELECT planning_land_type, COUNT(*)::int AS count
        FROM (
          SELECT ${FEATURE_TYPE_SQL} AS planning_land_type
          FROM planet_osm_polygon
          UNION ALL
          SELECT ${FEATURE_TYPE_SQL} AS planning_land_type
          FROM planet_osm_line
          WHERE highway IS NOT NULL OR waterway IS NOT NULL OR railway IS NOT NULL
        ) t
        GROUP BY planning_land_type
        ORDER BY count DESC, planning_land_type
        LIMIT 30
      `),
    ]);

    return {
      source: 'osm_hcm' as const,
      summary: summary.rows[0] as {
        parcel_count: number;
        avg_area: number;
        min_area: number;
        max_area: number;
      },
      districts: [] as Array<{ district: string; count: number }>,
      landTypes: landTypes.rows as Array<{ planning_land_type: string; count: number }>,
      wards: [] as Array<{ district: string; ward: string; count: number }>,
    };
  }
}
