import * as path from 'node:path';

/** MVT layer names — must match MapLibre `source-layer` in Phase 3. */
export const LAND_PARCELS_LAYER = 'parcels';
/** Point centroids + house_no — symbol labels (polygon labels fail on overzoom). */
export const LAND_PARCELS_HOUSE_LAYER = 'parcel-housenos';
export const QHSDD_LAYER = 'qhsdd';

export const MVT_EXTENT = 4096;
/** Wider buffer reduces hairline gaps at tile seams after ST_AsMVTGeom clipping. */
export const MVT_BUFFER = 256;

export const LAND_PARCELS_MIN_ZOOM = 8;
/** Overview quy hoạch — zoom xa vẫn thấy màu vùng (text riêng ở z≥17). */
export const QHSDD_MIN_ZOOM = 8;
/** Phải khớp zoom crawl (`crawl_hcm_qhsdd.py --zoom`). MapLibre overzoom trên mức này. */
export const QHSDD_MAX_TILE_ZOOM = 12;
/** Pre-gen + serve tới z16; MapLibre overzoom z17+ (db.md §9). */
export const LAND_PARCELS_MAX_TILE_ZOOM = 16;

export const HCM_PROVINCE_CODE = '79';

/** Giới hạn polygon/tile cho tile dày (P95 z15 ≈ 6k). */
export const TILE_FEATURE_LIMIT = 8_000;

export const TILE_CACHE_MAX_AGE_SEC = 86_400;

/**
 * Bump when MVT feature properties / layers change so disk/RAM cache stays coherent.
 * v2: house_no on polygon props
 * v3: parcel-housenos point layer for reliable labels
 * v4: parcel_id (not id) on house points + buffered centroids + house_no on polys
 * v5: shared tile_parcels CTE so house labels use the same LIMIT set as polygons
 */
export const MVT_CACHE_SCHEMA = 5;

/** Thư mục pre-gen/cache MVT — mặc định `data/tile-cache` (repo root). */
export function tileCacheRoot(): string {
  const fromEnv = process.env.TILE_CACHE_DIR?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return path.resolve(process.cwd(), '..', 'data', 'tile-cache');
}

export type TileKind = 'land-parcels' | 'qhsdd';

export function minZoomFor(kind: TileKind): number {
  return kind === 'land-parcels' ? LAND_PARCELS_MIN_ZOOM : QHSDD_MIN_ZOOM;
}

/**
 * Simplification tolerance in degrees (WGS84).
 * null → do not serve tile content for this zoom.
 */
export function simplifyToleranceDeg(z: number, kind: TileKind): number | null {
  if (kind === 'land-parcels') {
    if (z < LAND_PARCELS_MIN_ZOOM) return null;
    // Adjacent parcels share edges — per-feature ST_Simplify opens visible gaps.
    return 0;
  }

  if (z < QHSDD_MIN_ZOOM) return null;
  // Geometry is z12 tile fragments in DB — no per-zoom simplify (changes shapes by zoom).
  return 0;
}

export function parseTileInt(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`${label} phải là số nguyên`);
  }
  return n;
}

export function assertTileCoords(z: number, x: number, y: number): void {
  if (z < 0 || z > 22) {
    throw new Error('zoom không hợp lệ');
  }
  const max = 2 ** z;
  if (x < 0 || x >= max || y < 0 || y >= max) {
    throw new Error('tọa độ tile không hợp lệ');
  }
}
