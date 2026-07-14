/**
 * Pre-generate MVT tiles to disk (db.md §9 — ưu tiên 1).
 *
 * Parcels: z8–15 (optional z16 via PREGEN_PARCELS_MAX_ZOOM=16)
 * QHSDD:   z8–12
 *
 * Usage:
 *   PGPORT=5433 npm run tiles:pregen
 *   npm run tiles:pregen -- --kind=land-parcels --min-zoom=15 --max-zoom=15
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const DB_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/hcm_land_mvp';

const HCM_PROVINCE_CODE = '79';
const MVT_EXTENT = 4096;
const MVT_BUFFER = 256;
const TILE_FEATURE_LIMIT = Number(process.env.TILE_FEATURE_LIMIT || 8000);

const CACHE_ROOT = process.env.TILE_CACHE_DIR
  ? path.isAbsolute(process.env.TILE_CACHE_DIR)
    ? process.env.TILE_CACHE_DIR
    : path.resolve(process.cwd(), process.env.TILE_CACHE_DIR)
  : path.resolve(__dirname, '../data/tile-cache');

const LAND_PARCELS_LAYER = 'parcels';
const QHSDD_LAYER = 'qhsdd';

function parseArgs(argv) {
  const opts = {
    kind: 'all',
    minZoom: null,
    maxZoom: null,
    parcelsMaxZoom: Number(process.env.PREGEN_PARCELS_MAX_ZOOM || 15),
    dryRun: false,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--kind=')) opts.kind = arg.slice('--kind='.length);
    else if (arg.startsWith('--min-zoom=')) opts.minZoom = Number(arg.slice('--min-zoom='.length));
    else if (arg.startsWith('--max-zoom=')) opts.maxZoom = Number(arg.slice('--max-zoom='.length));
    else if (arg.startsWith('--parcels-max-zoom=')) {
      opts.parcelsMaxZoom = Number(arg.slice('--parcels-max-zoom='.length));
    }
  }
  return opts;
}

function tilePath(kind, z, x, y) {
  return path.join(CACHE_ROOT, kind, String(z), String(x), `${y}.mvt`);
}

function buildLandParcelsSql() {
  return `
    SELECT ST_AsMVT(mvt_row, '${LAND_PARCELS_LAYER}', ${MVT_EXTENT}, 'geom') AS tile
    FROM (
      SELECT
        id,
        property_code,
        district,
        ward,
        ST_AsMVTGeom(
          ST_Transform(geom, 3857),
          ST_TileEnvelope($1, $2, $3),
          ${MVT_EXTENT},
          ${MVT_BUFFER},
          true
        ) AS geom
      FROM land_parcels
      WHERE province_code = $4
        AND geom IS NOT NULL
        AND geom && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)
      LIMIT ${TILE_FEATURE_LIMIT}
    ) AS mvt_row
  `;
}

function buildQhsddSql() {
  return `
    SELECT ST_AsMVT(mvt_row, '${QHSDD_LAYER}', ${MVT_EXTENT}, 'geom') AS tile
    FROM (
      SELECT
        id,
        loai_dat_quy_hoach,
        fill_hex,
        district,
        ward,
        ST_AsMVTGeom(
          ST_Transform(geom, 3857),
          ST_TileEnvelope($1, $2, $3),
          ${MVT_EXTENT},
          ${MVT_BUFFER},
          true
        ) AS geom
      FROM hcm_qhsdd
      WHERE geom IS NOT NULL
        AND geom && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)
    ) AS mvt_row
  `;
}

async function listParcelTiles(client, z) {
  const n = 2 ** z;
  const { rows } = await client.query(
    `
    SELECT DISTINCT
      FLOOR((ST_X(ST_Centroid(geom)) + 180) / 360 * $1)::int AS x,
      FLOOR(
        (1 - LN(TAN(RADIANS(ST_Y(ST_Centroid(geom)))) + 1 / COS(RADIANS(ST_Y(ST_Centroid(geom))))) / PI())
        / 2 * $1
      )::int AS y
    FROM land_parcels
    WHERE province_code = $2 AND geom IS NOT NULL
    `,
    [n, HCM_PROVINCE_CODE],
  );
  return rows.map((r) => ({ z, x: r.x, y: r.y }));
}

async function listQhsddTiles(client, z) {
  const n = 2 ** z;
  const { rows } = await client.query(
    `
    SELECT DISTINCT
      FLOOR((ST_X(ST_Centroid(geom)) + 180) / 360 * $1)::int AS x,
      FLOOR(
        (1 - LN(TAN(RADIANS(ST_Y(ST_Centroid(geom)))) + 1 / COS(RADIANS(ST_Y(ST_Centroid(geom))))) / PI())
        / 2 * $1
      )::int AS y
    FROM hcm_qhsdd
    WHERE geom IS NOT NULL
    `,
    [n],
  );
  return rows.map((r) => ({ z, x: r.x, y: r.y }));
}

async function writeTile(filePath, buffer) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, buffer);
}

async function pregenKind(client, kind, minZ, maxZ, opts) {
  const listFn = kind === 'land-parcels' ? listParcelTiles : listQhsddTiles;
  const sql = kind === 'land-parcels' ? buildLandParcelsSql() : buildQhsddSql();
  const paramsBase = kind === 'land-parcels' ? [HCM_PROVINCE_CODE] : [];

  let total = 0;
  let written = 0;
  let skipped = 0;
  let bytes = 0;
  const started = Date.now();

  for (let z = minZ; z <= maxZ; z += 1) {
    const tiles = await listFn(client, z);
    console.log(`[${kind}] z${z}: ${tiles.length} tile có data`);
    total += tiles.length;

    for (const { x, y } of tiles) {
      const out = tilePath(kind, z, x, y);
      if (fs.existsSync(out) && !process.env.PREGEN_FORCE) {
        skipped += 1;
        continue;
      }
      if (opts.dryRun) {
        written += 1;
        continue;
      }

      const params = [z, x, y, ...paramsBase];
      const t0 = Date.now();
      const { rows } = await client.query(sql, params);
      const tile = rows[0]?.tile;
      const ms = Date.now() - t0;

      if (!tile || tile.length === 0) {
        continue;
      }

      await writeTile(out, tile);
      written += 1;
      bytes += tile.length;

      if (written % 50 === 0) {
        console.log(
          `  … ${written} tile (${(bytes / 1024 / 1024).toFixed(1)} MB), last ${ms}ms`,
        );
      }
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[${kind}] xong: ${written} ghi, ${skipped} bỏ qua (đã có), ${total} tile, ${(bytes / 1024 / 1024).toFixed(1)} MB, ${elapsed}s`,
  );
  return { total, written, skipped, bytes };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log('Tile cache:', CACHE_ROOT);
  console.log('DB:', DB_URL.replace(/:[^:@]+@/, ':***@'));
  if (opts.dryRun) console.log('DRY RUN — không ghi file');

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  const summary = { total: 0, written: 0, skipped: 0, bytes: 0 };

  if (opts.kind === 'all' || opts.kind === 'qhsdd') {
    const minZ = opts.minZoom ?? 8;
    const maxZ = opts.maxZoom ?? 12;
    const r = await pregenKind(client, 'qhsdd', minZ, maxZ, opts);
    summary.total += r.total;
    summary.written += r.written;
    summary.skipped += r.skipped;
    summary.bytes += r.bytes;
  }

  if (opts.kind === 'all' || opts.kind === 'land-parcels') {
    const minZ = opts.minZoom ?? 8;
    const maxZ = opts.maxZoom ?? opts.parcelsMaxZoom;
    const r = await pregenKind(client, 'land-parcels', minZ, maxZ, opts);
    summary.total += r.total;
    summary.written += r.written;
    summary.skipped += r.skipped;
    summary.bytes += r.bytes;
  }

  await client.end();

  console.log('');
  console.log(
    `Tổng: ${summary.written} ghi, ${summary.skipped} bỏ qua, ${summary.total} tile, ${(summary.bytes / 1024 / 1024).toFixed(1)} MB`,
  );
  console.log(`Bật cache runtime: TILE_CACHE_ENABLED=1 trong .env (repo root)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
