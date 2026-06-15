import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../shared/database.service';

type ParcelFilters = {
  q?: string;
  district?: string;
  ward?: string;
  landType?: string;
  minArea?: number;
  maxArea?: number;
  limit?: number;
};

@Injectable()
export class ParcelsService {
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

    const limit = Math.min(Math.max(filters.limit || 300, 1), 10000);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

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
        property_uuid,
        geometry_json
      FROM land_parcels
      ${whereSql}
      ORDER BY id
      LIMIT ${addParam(limit)}
      `,
      params,
    );

    return rows;
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
      summary: summary.rows[0],
      districts: districts.rows,
      landTypes: landTypes.rows,
      wards: wards.rows,
    };
  }
}
