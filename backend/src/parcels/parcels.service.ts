import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../shared/database.service';

type ParcelFilters = {
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
  limit?: number;
};

type StatsResponse = {
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
const PARCEL_MAX_LIMIT = 5000;
const SEARCH_MAX_LIMIT = 200;

@Injectable()
export class ParcelsService {
  private statsCache: { data: StatsResponse; expiresAt: number } | null = null;

  constructor(private readonly db: DatabaseService) {}

  async list(filters: ParcelFilters) {
    const where: string[] = [];
    const params: unknown[] = [];

    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (filters.q?.trim()) {
      const token = `%${filters.q.trim()}%`;
      const param = addParam(token);
      where.push(
        `(address ILIKE ${param} OR property_code ILIKE ${param} OR property_uuid ILIKE ${param})`,
      );
    }

    if (filters.district) where.push(`district = ${addParam(filters.district)}`);
    if (filters.ward) where.push(`ward = ${addParam(filters.ward)}`);
    if (filters.landType)
      where.push(`planning_land_type = ${addParam(filters.landType)}`);
    if (Number.isFinite(filters.minArea))
      where.push(`total_area >= ${addParam(filters.minArea)}`);
    if (Number.isFinite(filters.maxArea))
      where.push(`total_area <= ${addParam(filters.maxArea)}`);

    const hasBbox =
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

    const includeGeometry = filters.includeGeometry ?? false;
    const isSearch = Boolean(filters.q?.trim());
    const defaultLimit = isSearch ? SEARCH_MAX_LIMIT : PARCEL_MAX_LIMIT;
    const limit = Math.min(
      Math.max(filters.limit || defaultLimit, 1),
      isSearch ? SEARCH_MAX_LIMIT : PARCEL_MAX_LIMIT,
    );

    const geometryColumn = includeGeometry ? ', geometry_json' : '';
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = isSearch ? 'ORDER BY id' : '';

    const { rows } = await this.db.query(
      `
      SELECT
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
        property_uuid
        ${geometryColumn}
      FROM land_parcels
      ${whereSql}
      ${orderSql}
      LIMIT ${addParam(limit + 1)}
      `,
      params,
    );

    const truncated = rows.length > limit;
    const items = truncated ? rows.slice(0, limit) : rows;

    return { items, truncated, returned: items.length };
  }

  async getById(id: number) {
    if (!Number.isFinite(id)) throw new NotFoundException('Parcel not found');

    const { rows } = await this.db.query(
      'SELECT * FROM land_parcels WHERE id = $1 LIMIT 1',
      [id],
    );

    if (!rows[0]) throw new NotFoundException('Parcel not found');
    return rows[0];
  }

  async stats() {
    const now = Date.now();
    if (this.statsCache && this.statsCache.expiresAt > now) {
      return this.statsCache.data;
    }

    const data = await this.loadStats();
    this.statsCache = { data, expiresAt: now + STATS_TTL_MS };
    return data;
  }

  private async loadStats(): Promise<StatsResponse> {
    const [summary, districts, landTypes, wards] = await Promise.all([
      this.db.query(`
        SELECT
          COUNT(*)::int AS parcel_count,
          ROUND(AVG(total_area)::numeric, 2)::float AS avg_area,
          MIN(total_area)::float AS min_area,
          MAX(total_area)::float AS max_area
        FROM land_parcels
      `),
      this.db.query(`
        SELECT district, COUNT(*)::int AS count
        FROM land_parcels
        GROUP BY district
        ORDER BY count DESC, district
      `),
      this.db.query(`
        SELECT planning_land_type, COUNT(*)::int AS count
        FROM land_parcels
        GROUP BY planning_land_type
        ORDER BY count DESC, planning_land_type
      `),
      this.db.query(`
        SELECT district, ward, COUNT(*)::int AS count
        FROM land_parcels
        GROUP BY district, ward
        ORDER BY district, ward
      `),
    ]);

    return {
      summary: summary.rows[0] as StatsResponse['summary'],
      districts: districts.rows as StatsResponse['districts'],
      landTypes: landTypes.rows as StatsResponse['landTypes'],
      wards: wards.rows as StatsResponse['wards'],
    };
  }
}
