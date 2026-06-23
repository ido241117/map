import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../shared/database.service';

export const QHSDD_MIN_ZOOM = 8;

type QhsddFilters = {
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  landType?: string;
  zoom?: number;
  limit?: number;
};

@Injectable()
export class QhsddService {
  constructor(private readonly db: DatabaseService) {}

  async listInViewport(filters: QhsddFilters) {
    if (
      filters.zoom !== undefined &&
      Number.isFinite(filters.zoom) &&
      filters.zoom < QHSDD_MIN_ZOOM
    ) {
      return { items: [], returned: 0, truncated: false };
    }

    const where: string[] = [];
    const params: unknown[] = [];

    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (Number.isFinite(filters.minLat)) {
      where.push(`center_lat >= ${addParam(filters.minLat)}`);
    }
    if (Number.isFinite(filters.maxLat)) {
      where.push(`center_lat <= ${addParam(filters.maxLat)}`);
    }
    if (Number.isFinite(filters.minLng)) {
      where.push(`center_long >= ${addParam(filters.minLng)}`);
    }
    if (Number.isFinite(filters.maxLng)) {
      where.push(`center_long <= ${addParam(filters.maxLng)}`);
    }
    if (filters.landType) {
      where.push(`loai_dat_quy_hoach = ${addParam(filters.landType)}`);
    }

    const limit = Math.min(Math.max(filters.limit || 8000, 1), 12000);
    params.push(limit + 1);
    const limitParam = `$${params.length}`;

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await this.db.query(
      `
      SELECT
        id,
        feature_id,
        loai_dat_quy_hoach,
        center_lat,
        center_long,
        red,
        green,
        blue,
        fill_hex,
        geometry_json
      FROM hcm_qhsdd
      ${whereSql}
      ORDER BY id
      LIMIT ${limitParam}
      `,
      params,
    );

    const truncated = rows.length > limit;
    const items = truncated ? rows.slice(0, limit) : rows;

    return { items, returned: items.length, truncated };
  }

  async stats() {
    const [summary, landTypes] = await Promise.all([
      this.db.query(`
        SELECT COUNT(*)::int AS zone_count
        FROM hcm_qhsdd
      `),
      this.db.query(`
        SELECT loai_dat_quy_hoach, COUNT(*)::int AS count
        FROM hcm_qhsdd
        WHERE loai_dat_quy_hoach IS NOT NULL AND BTRIM(loai_dat_quy_hoach) <> ''
        GROUP BY loai_dat_quy_hoach
        ORDER BY count DESC, loai_dat_quy_hoach
        LIMIT 200
      `),
    ]);

    return {
      summary: summary.rows[0] as { zone_count: number },
      landTypes: landTypes.rows as Array<{ loai_dat_quy_hoach: string; count: number }>,
    };
  }
}
