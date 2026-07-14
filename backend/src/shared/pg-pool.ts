import { Pool, type PoolConfig } from 'pg';

/** pg default is 10 — override via PG_POOL_MAX or per-db env. */
export function resolvePoolMax(envName?: string, fallback = 10): number {
  const raw = (envName && process.env[envName]) || process.env.PG_POOL_MAX;
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function createAppPool(config: PoolConfig & { label: string }): Pool {
  const { label, ...poolConfig } = config;
  const pool = new Pool(poolConfig);
  const max = poolConfig.max ?? 10;
  console.log(`[pg:${label}] pool max=${max}`);

  const intervalMs = Number(process.env.PG_POOL_LOG_MS || 0);
  if (intervalMs > 0) {
    const timer = setInterval(() => {
      const waiting = pool.waitingCount;
      if (waiting > 0 || process.env.PG_POOL_LOG_ALWAYS === '1') {
        console.log(
          `[pg:${label}] total=${pool.totalCount} idle=${pool.idleCount} waiting=${waiting}`,
        );
      }
    }, intervalMs);
    timer.unref();
  }

  return pool;
}

export type PoolStats = {
  max: number;
  total: number;
  idle: number;
  waiting: number;
};

export function poolStats(pool: Pool, max: number): PoolStats {
  return {
    max,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}
