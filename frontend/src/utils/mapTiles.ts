import { wrapMapMvtUrl } from './mapTileLoader';
import { viteEnvInt } from './viteEnvInt';

/** Keep layer names in sync with backend/src/tiles/tile-config.ts */
export const LAND_PARCELS_LAYER = 'parcels';
export const LAND_PARCELS_HOUSE_LAYER = 'parcel-housenos';
export const QHSDD_LAYER = 'qhsdd';
export const HIGHWAYS_LAYER = 'highways';
export const RAILWAYS_LAYER = 'railways';

/** Bust browser HTTP cache when MVT schema/layers change (must match backend MVT_CACHE_SCHEMA). */
export const MVT_CACHE_SCHEMA = 5;

/** Pre-gen tới z16 — MapLibre overzoom z17+ (db.md §9). */
export const LAND_PARCELS_MAX_TILE_ZOOM = 16;
/** Khớp crawl QHSDD — MapLibre overzoom, tránh đổi hình khi zoom 13↔14. */
export const QHSDD_MAX_TILE_ZOOM = 12;
export const HIGHWAYS_MAX_TILE_ZOOM = 16;
export const RAILWAYS_MAX_TILE_ZOOM = 16;

/** Serve / request MVT thửa đất từ zoom này — khớp backend `LAND_PARCELS_MIN_ZOOM`. */
export const LAND_PARCELS_MIN_ZOOM = viteEnvInt('LAND_PARCELS_MIN_ZOOM', 8);
/** Hiện / load QHSDD từ zoom này — khớp backend `QHSDD_MIN_ZOOM`. */
export const QHSDD_MIN_ZOOM = viteEnvInt('QHSDD_MIN_ZOOM', 8);
/** Hiện lớp lộ giới từ zoom này — khớp backend `HIGHWAYS_MIN_ZOOM`. */
export const HIGHWAYS_MIN_ZOOM = viteEnvInt('HIGHWAYS_MIN_ZOOM', 10);
/** Hiện lớp đường sắt từ zoom này — khớp backend `RAILWAYS_MIN_ZOOM`. */
export const RAILWAYS_MIN_ZOOM = viteEnvInt('RAILWAYS_MIN_ZOOM', 0);
/** Hiện chấm nhà ga metro L1 từ zoom này (`RAILWAYS_STATIONS_MIN_ZOOM`). */
export const RAILWAYS_STATIONS_MIN_ZOOM = viteEnvInt('RAILWAYS_STATIONS_MIN_ZOOM', 0);

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

function appendTileQuery(base: string, admin?: AdminTileFilter): string {
  const params = new URLSearchParams();
  params.set('v', String(MVT_CACHE_SCHEMA));
  if (admin?.district?.trim()) params.set('district', admin.district.trim());
  if (admin?.ward?.trim()) params.set('ward', admin.ward.trim());
  return `${base}?${params.toString()}`;
}

/** Protocol-wrapped so loads go through concurrency limit + retry (see mapTileLoader). */
export function landParcelsTileUrl(admin?: AdminTileFilter) {
  return wrapMapMvtUrl(
    appendTileQuery(`${absoluteApiBase()}/tiles/land-parcels/{z}/{x}/{y}`, admin),
  );
}

export function qhsddTileUrl(admin?: AdminTileFilter) {
  return wrapMapMvtUrl(appendTileQuery(`${absoluteApiBase()}/tiles/qhsdd/{z}/{x}/{y}`, admin));
}

export function highwaysTileUrl() {
  return wrapMapMvtUrl(appendTileQuery(`${absoluteApiBase()}/tiles/highways/{z}/{x}/{y}`));
}

export function railwaysTileUrl() {
  return wrapMapMvtUrl(appendTileQuery(`${absoluteApiBase()}/tiles/railways/{z}/{x}/{y}`));
}
