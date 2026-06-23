import { Injectable } from '@nestjs/common';
import { normalizeSearchQuery } from '../shared/address-normalize';
import { parseParcelSource, type ParcelSource } from '../parcels/parcel-sources';
import { ElasticService } from './elastic.service';

export type ParcelSearchHit = {
  id: number;
  source: ParcelSource;
  address: string;
  full_address: string;
  ward: string;
  district: string;
  province: string;
  property_code: string;
  latitude: number;
  longitude: number;
  score: number;
};

type SearchFilters = {
  source?: string;
  q: string;
  district?: string;
  ward?: string;
  limit?: number;
};

@Injectable()
export class ParcelSearchService {
  constructor(private readonly elastic: ElasticService) {}

  async searchIds(filters: SearchFilters): Promise<number[] | null> {
    const available = await this.elastic.isAvailable();
    if (!available) return null;

    const source = parseParcelSource(filters.source);
    const query = normalizeSearchQuery(filters.q);
    if (!query) return [];

    const limit = Math.min(Math.max(filters.limit || 200, 1), 10000);
    const must: Record<string, unknown>[] = [
      {
        multi_match: {
          query,
          fields: [
            'search_text^4',
            'full_address^3',
            'address^2',
            'street_line^2',
            'property_code^2',
            'ward^1.5',
            'district^1.5',
            'province',
          ],
          type: 'best_fields',
          fuzziness: 'AUTO',
        },
      },
    ];

    const filter: Record<string, unknown>[] = [{ term: { source } }];

    if (filters.district?.trim()) {
      filter.push({ term: { district: filters.district.trim() } });
    }
    if (filters.ward?.trim()) {
      filter.push({ term: { ward: filters.ward.trim() } });
    }

    const result = await this.elastic.search<{ id: number }>({
      size: limit,
      query: {
        bool: {
          must,
          filter,
        },
      },
      _source: ['id'],
    });

    return result.hits.hits
      .map((hit) => hit._source?.id)
      .filter((id): id is number => Number.isFinite(id));
  }

  async suggest(filters: {
    source?: string;
    q: string;
    limit?: number;
    district?: string;
    ward?: string;
  }): Promise<ParcelSearchHit[] | null> {
    const available = await this.elastic.isAvailable();
    if (!available) return null;

    const source = parseParcelSource(filters.source);
    const query = normalizeSearchQuery(filters.q);
    if (query.length < 2) return [];

    const limit = Math.min(Math.max(filters.limit || 10, 1), 20);
    const filter: Record<string, unknown>[] = [{ term: { source } }];

    if (filters.district?.trim()) {
      filter.push({ term: { district: filters.district.trim() } });
    }
    if (filters.ward?.trim()) {
      filter.push({ term: { ward: filters.ward.trim() } });
    }

    const result = await this.elastic.search<{
      id: number;
      source: ParcelSource;
      address: string;
      full_address: string;
      ward: string;
      district: string;
      province: string;
      property_code: string;
      latitude: number;
      longitude: number;
    }>({
      size: limit,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: [
                  'search_text^4',
                  'full_address^3',
                  'address^2',
                  'ward^1.5',
                  'district^1.5',
                ],
                type: 'bool_prefix',
              },
            },
          ],
          filter,
        },
      },
      _source: [
        'id',
        'source',
        'address',
        'full_address',
        'ward',
        'district',
        'province',
        'property_code',
        'latitude',
        'longitude',
      ],
    });

    return result.hits.hits
      .map((hit) => {
        const doc = hit._source;
        if (!doc) return null;
        return {
          ...doc,
          score: hit._score ?? 0,
        };
      })
      .filter((item): item is ParcelSearchHit => item !== null);
  }
}
