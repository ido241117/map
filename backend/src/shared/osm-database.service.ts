import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';

function isDbConnectionError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') return true;
  if (error instanceof AggregateError) {
    return error.errors.some((item) => isDbConnectionError(item));
  }
  return Boolean(err.message?.includes('ECONNREFUSED'));
}

@Injectable()
export class OsmDatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString:
      process.env.OSM_DATABASE_URL ||
      'postgres://postgres:postgres@localhost:5433/osm_hcm',
  });

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    try {
      return await this.pool.query<T>(text, params);
    } catch (error) {
      if (isDbConnectionError(error)) {
        throw new ServiceUnavailableException(
          'CSDL OpenStreetMap chưa sẵn sàng. Chạy: docker compose -f docker-compose.postgis.yml up -d',
        );
      }
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
