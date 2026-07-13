import { wrapMapMvtUrl } from './mapTileLoader';

/** Keep in sync with backend/src/tiles/tile-config.ts */
export const LAND_PARCELS_LAYER = 'parcels';
export const QHSDD_LAYER = 'qhsdd';

export const LAND_PARCELS_MIN_ZOOM = 8;
/** Pre-gen tới z16 — MapLibre overzoom z17+ (db.md §9). */
export const LAND_PARCELS_MAX_TILE_ZOOM = 16;
export const QHSDD_MIN_ZOOM = 8;
/** Khớp crawl QHSDD — MapLibre overzoom, tránh đổi hình khi zoom 13↔14. */
export const QHSDD_MAX_TILE_ZOOM = 12;

export const HCM_CENTER: [number, number] = [106.7009, 10.7769];

/** MapLibre loads tiles via Request(), which requires an absolute URL. */
function absoluteApiBase(): string {
  const configured = String(import.meta.env.VITE_API_URL || '/api');
  if (/^https?:\/\//i.test(configured)) {
    return configured.replace(/\/$/, '');
  }
  const path = configured.startsWith('/') ? configured : `/${configured}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${path}`.replace(/\/$/, '');
}

export type AdminTileFilter = {
  district?: string;
  ward?: string;
};

function appendAdminQuery(base: string, admin?: AdminTileFilter): string {
  const params = new URLSearchParams();
  if (admin?.district?.trim()) params.set('district', admin.district.trim());
  if (admin?.ward?.trim()) params.set('ward', admin.ward.trim());
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Protocol-wrapped so loads go through concurrency limit + retry (see mapTileLoader). */
export function landParcelsTileUrl(admin?: AdminTileFilter) {
  return wrapMapMvtUrl(
    appendAdminQuery(`${absoluteApiBase()}/tiles/land-parcels/{z}/{x}/{y}`, admin),
  );
}

export function qhsddTileUrl(admin?: AdminTileFilter) {
  return wrapMapMvtUrl(appendAdminQuery(`${absoluteApiBase()}/tiles/qhsdd/{z}/{x}/{y}`, admin));
}
