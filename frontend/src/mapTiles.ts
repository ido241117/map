/** Keep in sync with backend/src/tiles/tile-config.ts */
export const LAND_PARCELS_LAYER = 'parcels';
export const QHSDD_LAYER = 'qhsdd';

export const LAND_PARCELS_MIN_ZOOM = 8;
export const QHSDD_MIN_ZOOM = 8;
/** Khớp crawl QHSDD — MapLibre overzoom, tránh đổi hình khi zoom 13↔14. */
export const QHSDD_MAX_TILE_ZOOM = 12;
/** Bump sau re-crawl / re-import để tránh browser cache MVT cũ (max-age 24h). */
export const QHSDD_TILE_DATA_VERSION = 3;

export const HCM_CENTER: [number, number] = [106.7009, 10.7769];

/** MapLibre loads tiles via Request(), which requires an absolute URL. */
function absoluteApiBase(): string {
  const configured = import.meta.env.VITE_API_URL || '/api';
  if (/^https?:\/\//i.test(configured)) {
    return configured.replace(/\/$/, '');
  }
  const path = configured.startsWith('/') ? configured : `/${configured}`;
  return `${window.location.origin}${path}`.replace(/\/$/, '');
}

export function landParcelsTileUrl() {
  return `${absoluteApiBase()}/tiles/land-parcels/{z}/{x}/{y}`;
}

export function qhsddTileUrl() {
  return `${absoluteApiBase()}/tiles/qhsdd/{z}/{x}/{y}?v=${QHSDD_TILE_DATA_VERSION}`;
}
