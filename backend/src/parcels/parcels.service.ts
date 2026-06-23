import { Injectable, NotFoundException } from '@nestjs/common';
import { ParcelSearchService } from '../search/parcel-search.service';
import { DatabaseService } from '../shared/database.service';
import {
  geometryColumnForSource,
  parseParcelSource,
  SOURCE_SQL,
  type ParcelSource,
} from './parcel-sources';
import {
  shouldIncludeGeometry,
  VIEWPORT_GEOMETRY_LIMIT,
  VIEWPORT_MARKER_LIMIT,
} from './map-viewport';

type ParcelFilters = {
  source?: string;
  q?: string;
  district?: string;
  ward?: string;
  landType?: string;
  minArea?: number;
  maxArea?: number;
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  includeGeometry?: boolean;
  zoom?: number;
  limit?: number;
};

type StatsResponse = {
  source: ParcelSource;
  summary: {
    parcel_count: number;
    avg_area: number;
    min_area: number;
    max_area: number;
  };
  districts: Array<{ district: string; count: number }>;
  landTypes: Array<{ planning_land_type: string; count: number }>;
  wards: Array<{ district: string; ward: string; count: number }>;
};

const STATS_TTL_MS = 10 * 60 * 1000;
const SEARCH_MAX_LIMIT = 10000;

@Injectable()
export class ParcelsService {
  private statsCache = new Map<ParcelSource, { data: StatsResponse; expiresAt: number }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly parcelSearch: ParcelSearchService,
  ) {}

  async list(filters: ParcelFilters) {
    const source = parseParcelSource(filters.source);
    const config = SOURCE_SQL[source];
    const where: string[] = [];
    const params: unknown[] = [];
    const isSearch = Boolean(filters.q?.trim());

    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (isSearch) {
      const esIds = await this.parcelSearch.searchIds({
        source,
        q: filters.q!.trim(),
        district: filters.district,
        ward: filters.ward,
        limit: SEARCH_MAX_LIMIT,
      });

      if (esIds) {
        if (!esIds.length) {
          return { source, mode: 'parcels' as const, items: [], clusters: [], truncated: false, returned: 0 };
        }
        return this.listByIds(source, esIds, filters);
      }

      const token = `%${filters.q!.trim()}%`;
      const param = addParam(token);
      where.push(config.searchClause.replace(/\$SEARCH/g, param));
    }

    if (filters.district) {
      where.push(`${config.districtColumn} = ${addParam(filters.district)}`);
    }
    if (filters.ward) {
      where.push(`${config.wardColumn} = ${addParam(filters.ward)}`);
    }
    if (filters.landType) {
      where.push(`${config.landTypeColumn} = ${addParam(filters.landType)}`);
    }
    if (Number.isFinite(filters.minArea)) {
      where.push(`total_area >= ${addParam(filters.minArea)}`);
    }
    if (Number.isFinite(filters.maxArea)) {
      where.push(`total_area <= ${addParam(filters.maxArea)}`);
    }

    const hasBbox =
      !isSearch &&
      Number.isFinite(filters.minLat) &&
      Number.isFinite(filters.maxLat) &&
      Number.isFinite(filters.minLng) &&
      Number.isFinite(filters.maxLng);

    if (hasBbox) {
      where.push(`latitude >= ${addParam(filters.minLat)}`);
      where.push(`latitude <= ${addParam(filters.maxLat)}`);
      where.push(`longitude >= ${addParam(filters.minLng)}`);
      where.push(`longitude <= ${addParam(filters.maxLng)}`);
    }

    const includeGeometry = shouldIncludeGeometry(
      filters.zoom,
      isSearch,
      filters.includeGeometry,
    );
    const limit = this.resolveListLimit(filters, isSearch, hasBbox, includeGeometry);
    const geometryColumn = includeGeometry ? geometryColumnForSource(source) : '';
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = isSearch ? 'ORDER BY id' : '';
    const limitSql =
      limit !== undefined ? `LIMIT ${addParam(limit + 1)}` : '';

    const { rows } = await this.db.query(
      `
      SELECT
        ${config.selectColumns}
        ${geometryColumn}
      FROM ${config.table}
      ${whereSql}
      ${orderSql}
      ${limitSql}
      `,
      params,
    );

    const truncated = limit !== undefined && rows.length > limit;
    const items = truncated ? rows.slice(0, limit) : rows;

    return { source, mode: 'parcels' as const, items, clusters: [], truncated, returned: items.length };
  }

  /** Search keeps a cap; map viewport uses bounded limits for demo scale. */
  private resolveListLimit(
    filters: ParcelFilters,
    isSearch: boolean,
    hasBbox: boolean,
    includeGeometry: boolean,
  ): number | undefined {
    if (isSearch) {
      return Math.min(Math.max(filters.limit || SEARCH_MAX_LIMIT, 1), SEARCH_MAX_LIMIT);
    }
    if (filters.limit !== undefined && Number.isFinite(filters.limit)) {
      return Math.max(filters.limit, 1);
    }
    if (!hasBbox) return undefined;
    return includeGeometry ? VIEWPORT_GEOMETRY_LIMIT : VIEWPORT_MARKER_LIMIT;
  }

  async suggestAddress(
    sourceInput: string | undefined,
    q: string,
    limit?: number,
    district?: string,
    ward?: string,
  ) {
    const source = parseParcelSource(sourceInput);
    const items = await this.parcelSearch.suggest({ source, q, limit, district, ward });
    return {
      source,
      items: items ?? [],
      engine: items ? 'elasticsearch' : 'unavailable',
    };
  }

  async adminBounds(district?: string, ward?: string) {
    const config = SOURCE_SQL.land_parcels;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (district?.trim()) {
      params.push(district.trim());
      conditions.push(`${config.districtColumn} = $${params.length}`);
    }
    if (ward?.trim()) {
      params.push(ward.trim());
      conditions.push(`${config.wardColumn} = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.db.query<{
      min_lat: number;
      max_lat: number;
      min_lng: number;
      max_lng: number;
      count: number;
    }>(
      `
      SELECT
        MIN(latitude)::float AS min_lat,
        MAX(latitude)::float AS max_lat,
        MIN(longitude)::float AS min_lng,
        MAX(longitude)::float AS max_lng,
        COUNT(*)::int AS count
      FROM ${config.table}
      ${where}
      `,
      params,
    );

    const row = rows[0];
    if (!row?.count) {
      return { count: 0, bounds: null };
    }

    return {
      count: row.count,
      bounds: {
        minLat: row.min_lat,
        maxLat: row.max_lat,
        minLng: row.min_lng,
        maxLng: row.max_lng,
      },
    };
  }

  private async listByIds(source: ParcelSource, ids: number[], filters: ParcelFilters) {
    const config = SOURCE_SQL[source];
    const includeGeometry = filters.includeGeometry ?? false;
    const geometryColumn = includeGeometry ? geometryColumnForSource(source) : '';
    const where: string[] = [`id = ANY($1::int[])`];
    const params: unknown[] = [ids];

    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (filters.landType) {
      where.push(`${config.landTypeColumn} = ${addParam(filters.landType)}`);
    }
    if (Number.isFinite(filters.minArea)) {
      where.push(`total_area >= ${addParam(filters.minArea)}`);
    }
    if (Number.isFinite(filters.maxArea)) {
      where.push(`total_area <= ${addParam(filters.maxArea)}`);
    }

    const limit = Math.min(Math.max(filters.limit || SEARCH_MAX_LIMIT, 1), SEARCH_MAX_LIMIT);
    params.push(ids);

    const { rows } = await this.db.query(
      `
      SELECT
        ${config.selectColumns}
        ${geometryColumn}
      FROM ${config.table}
      WHERE ${where.join(' AND ')}
      ORDER BY array_position($${params.length}::int[], id)
      LIMIT ${limit}
      `,
      params,
    );

    return {
      source,
      mode: 'parcels' as const,
      items: rows,
      clusters: [],
      truncated: rows.length >= limit,
      returned: rows.length,
    };
  }

  async getById(id: number, sourceInput?: string) {
    const source = parseParcelSource(sourceInput);
    const config = SOURCE_SQL[source];

    if (!Number.isFinite(id)) throw new NotFoundException('Parcel not found');

    const geometryColumn = geometryColumnForSource(source);
    const { rows } = await this.db.query(
      `
      SELECT
        ${config.selectColumns}
        ${geometryColumn}
      FROM ${config.table}
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );

    if (!rows[0]) throw new NotFoundException('Parcel not found');
    return rows[0];
  }

  async stats(sourceInput?: string) {
    const source = parseParcelSource(sourceInput);
    const now = Date.now();
    const cached = this.statsCache.get(source);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const data = await this.loadStats(source);
    this.statsCache.set(source, { data, expiresAt: now + STATS_TTL_MS });
    return data;
  }

  private async loadStats(source: ParcelSource): Promise<StatsResponse> {
    const config = SOURCE_SQL[source];
    const [summary, districts, landTypes, wards] = await Promise.all([
      this.db.query(`
        SELECT
          COUNT(*)::int AS parcel_count,
          ROUND(AVG(total_area)::numeric, 2)::float AS avg_area,
          MIN(total_area)::float AS min_area,
          MAX(total_area)::float AS max_area
        FROM ${config.table}
      `),
      this.db.query(config.statsDistrictSql),
      this.db.query(config.statsLandTypeSql),
      this.db.query(config.statsWardSql),
    ]);

    return {
      source,
      summary: summary.rows[0] as StatsResponse['summary'],
      districts: districts.rows as StatsResponse['districts'],
      landTypes: landTypes.rows as StatsResponse['landTypes'],
      wards: wards.rows as StatsResponse['wards'],
    };
  }
}
