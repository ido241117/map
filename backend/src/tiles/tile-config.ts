/** MVT layer names — must match MapLibre `source-layer` in Phase 3. */
export const LAND_PARCELS_LAYER = 'parcels';
export const QHSDD_LAYER = 'qhsdd';

export const MVT_EXTENT = 4096;
/** Wider buffer reduces hairline gaps at tile seams after ST_AsMVTGeom clipping. */
export const MVT_BUFFER = 128;

export const LAND_PARCELS_MIN_ZOOM = 15;
/** Overview quy hoạch — zoom xa vẫn thấy màu vùng (text riêng ở z≥17). */
export const QHSDD_MIN_ZOOM = 8;

export const HCM_PROVINCE_CODE = '79';

/** Tạm tắt — bật lại TILE_FEATURE_LIMIT khi optimize production. */
// export const TILE_FEATURE_LIMIT = 5000;

export const TILE_CACHE_MAX_AGE_SEC = 86_400;

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
    if (z <= 14) return null;
    // Adjacent parcels share edges — per-feature ST_Simplify opens visible gaps.
    return 0;
  }

  if (z < QHSDD_MIN_ZOOM) return null;
  if (z <= 9) return 0.001;
  if (z <= 11) return 0.0005;
  if (z <= 13) return 0.0002;
  if (z <= 15) return 0.00005;
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
