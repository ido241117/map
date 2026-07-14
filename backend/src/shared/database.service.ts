import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';
import { createAppPool, poolStats, resolvePoolMax, type PoolStats } from './pg-pool';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly poolMax = resolvePoolMax('PG_POOL_MAX');
  private readonly pool: Pool = createAppPool({
    label: 'main',
    connectionString:
      process.env.DATABASE_URL ||
      'postgres://postgres:postgres@localhost:5432/hcm_land_mvp',
    max: this.poolMax,
  });

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  getPoolStats(): PoolStats {
    return poolStats(this.pool, this.poolMax);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
