import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';
import { createAppPool, poolStats, resolvePoolMax, type PoolStats } from './pg-pool';

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
  /** OSM_PG_POOL_MAX → PG_POOL_MAX → 10 */
  private readonly poolMax = resolvePoolMax('OSM_PG_POOL_MAX');
  private readonly pool: Pool = createAppPool({
    label: 'osm',
    connectionString:
      process.env.OSM_DATABASE_URL ||
      'postgres://postgres:postgres@localhost:5435/osm_highways',
    max: this.poolMax,
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
          'CSDL OSM (highways/railways) chưa sẵn sàng. Chạy: npm run db:osm:highways:up',
        );
      }
      throw error;
    }
  }

  getPoolStats(): PoolStats {
    return poolStats(this.pool, this.poolMax);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
