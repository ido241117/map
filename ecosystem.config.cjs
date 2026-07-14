/**
 * PM2 cluster for map API (production-style).
 * From repo root: pm2 start ecosystem.config.cjs
 *
 * Postgres max_connections≈100 per DB — keep instances * PG_POOL_MAX under ~80.
 */
module.exports = {
  apps: [
    {
      name: 'map-api',
      cwd: __dirname + '/backend',
      script: 'dist/main.js',
      // Laptop benchmark: 2 workers ok hơn 4 (4 làm cache RAM phân tán + err tăng).
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        UV_THREADPOOL_SIZE: '64',
        // N * PG_POOL_MAX nên < ~80 (Postgres max_connections≈100).
        PG_POOL_MAX: '30',
        OSM_PG_POOL_MAX: '30',
        PG_POOL_LOG_MS: '2000',
      },
    },
  ],
};
