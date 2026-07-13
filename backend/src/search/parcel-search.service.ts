import { Injectable } from '@nestjs/common';
import { normalizeSearchQuery } from '../shared/address-normalize';
import { parseParcelSource, type ParcelSource } from '../parcels/parcel-sources';
import { ElasticService } from './elastic.service';

export type ParcelSearchHit = {
  id: number;
  source: ParcelSource;
  address: string;
  street_name: string;
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

function buildStreetMust(query: string) {
  return {
    bool: {
      should: [
        {
          match_phrase_prefix: {
            street_name: {
              query,
              boost: 4,
            },
          },
        },
        {
          match: {
            street_name: {
              query,
              operator: 'and',
              boost: 3,
            },
          },
        },
        {
          prefix: {
            street_name_norm: {
              value: query,
              boost: 2,
            },
          },
        },
        {
          match: {
            search_text: {
              query,
              operator: 'and',
              boost: 1,
            },
          },
        },
      ],
      minimum_should_match: 1,
    },
  };
}

function buildAdminFilter(source: ParcelSource, district?: string, ward?: string) {
  const filter: Record<string, unknown>[] = [
    { term: { source } },
    {
      bool: {
        must_not: [{ term: { street_name_norm: '' } }],
      },
    },
  ];

  if (district?.trim()) {
    filter.push({ term: { district: district.trim() } });
  }
  if (ward?.trim()) {
    filter.push({ term: { ward: ward.trim() } });
  }

  return filter;
}

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
    const result = await this.elastic.search<{ id: number }>({
      size: limit,
      query: {
        bool: {
          must: [buildStreetMust(query)],
          filter: buildAdminFilter(source, filters.district, filters.ward),
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

    const result = await this.elastic.search<{
      id: number;
      source: ParcelSource;
      address: string;
      street_name: string;
      full_address: string;
      ward: string;
      district: string;
      province: string;
      property_code: string;
      latitude: number;
      longitude: number;
    }>({
      size: limit,
      collapse: { field: 'street_name.keyword' },
      query: {
        bool: {
          must: [buildStreetMust(query)],
          filter: buildAdminFilter(source, filters.district, filters.ward),
        },
      },
      _source: [
        'id',
        'source',
        'address',
        'street_name',
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
          street_name: doc.street_name || '',
          score: hit._score ?? 0,
        };
      })
      .filter((item): item is ParcelSearchHit => item !== null);
  }
}
