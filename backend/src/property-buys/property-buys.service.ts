import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../shared/database.service';

export type PropertyBuyRecord = {
  id: number;
  record_id: number;
  customer_name: string | null;
  address: string;
  street: string;
  ward: string;
  district: string;
  city: string;
  price_buy: number;
  string: string | null;
  lat: number | null;
  long: number | null;
  imported_at: string;
};

export type PropertyBuyListResponse = {
  items: PropertyBuyRecord[];
  total: number;
  page: number;
  pageSize: number;
};

type ListFilters = {
  q?: string;
  district?: string;
  ward?: string;
  page?: number;
  pageSize?: number;
};

type MapPoint = {
  id: number;
  record_id: number;
  address: string;
  string: string | null;
  lat: number;
  long: number;
};

@Injectable()
export class PropertyBuysService {
  constructor(private readonly db: DatabaseService) {}

  async list(filters: ListFilters): Promise<PropertyBuyListResponse> {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.q?.trim()) {
      params.push(`%${filters.q.trim()}%`);
      const idx = params.length;
      conditions.push(
        `(customer_name ILIKE $${idx} OR address ILIKE $${idx} OR street ILIKE $${idx})`,
      );
    }
    if (filters.district?.trim()) {
      params.push(filters.district.trim());
      conditions.push(`district = $${params.length}`);
    }
    if (filters.ward?.trim()) {
      params.push(filters.ward.trim());
      conditions.push(`ward = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM property_buy_records ${where}`,
      params,
    );
    const total = Number(countResult.rows[0]?.count || 0);

    const listParams = [...params, pageSize, offset];
    const result = await this.db.query<PropertyBuyRecord>(
      `SELECT id, record_id, customer_name, address, street, ward, district, city, price_buy, string, lat, long, imported_at
       FROM property_buy_records
       ${where}
       ORDER BY id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    return {
      items: result.rows,
      total,
      page,
      pageSize,
    };
  }

  async filterOptions() {
    const districts = await this.db.query<{ district: string; count: string }>(
      `SELECT district, COUNT(*)::text AS count
       FROM property_buy_records
       GROUP BY district
       ORDER BY district`,
    );
    const wards = await this.db.query<{
      district: string;
      ward: string;
      count: string;
    }>(
      `SELECT district, ward, COUNT(*)::text AS count
       FROM property_buy_records
       GROUP BY district, ward
       ORDER BY district, ward`,
    );

    return {
      districts: districts.rows.map((r) => ({
        district: r.district,
        count: Number(r.count),
      })),
      wards: wards.rows.map((r) => ({
        district: r.district,
        ward: r.ward,
        count: Number(r.count),
      })),
    };
  }

  async mapPoints(limit = 100) {
    const safeLimit = Math.max(1, Math.min(5000, limit));
    const result = await this.db.query<MapPoint>(
      `SELECT id, record_id, address, string, lat, long
       FROM property_buy_records
       WHERE lat IS NOT NULL AND long IS NOT NULL
       ORDER BY id DESC
       LIMIT $1`,
      [safeLimit],
    );

    return {
      items: result.rows,
      total: result.rows.length,
    };
  }
}
