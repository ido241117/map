import { viteEnvInt } from './viteEnvInt';

/**
 * Zoom ≥ PARCELS_GEOMETRY_MIN_ZOOM: hiện ranh thửa (MultiPolygon).
 * Zoom nhỏ hơn: chỉ lớp quy hoạch.
 * Khớp backend `PARCELS_GEOMETRY_MIN_ZOOM`.
 */
export const GEOMETRY_MIN_ZOOM = viteEnvInt('PARCELS_GEOMETRY_MIN_ZOOM', 16);

/** Hiện / load QHSDD — khớp backend `QHSDD_MIN_ZOOM`. */
export const QHSDD_MIN_ZOOM = viteEnvInt('QHSDD_MIN_ZOOM', 8);

export const QHSDD_LABEL_MIN_ZOOM = viteEnvInt('QHSDD_LABEL_MIN_ZOOM', 16);

/** Số nhà trên thửa — khớp backend `HOUSE_NO_LABEL_MIN_ZOOM`. */
export const HOUSE_NO_LABEL_MIN_ZOOM = viteEnvInt('HOUSE_NO_LABEL_MIN_ZOOM', 18);

export function shouldShowQhsddOverlay(source: string | undefined, _zoom: number, isSearch: boolean) {
  if (isSearch) return false;
  return source === 'land_parcels';
}

export function shouldShowQhsddLabels(zoom: number) {
  return zoom >= QHSDD_LABEL_MIN_ZOOM;
}

export function shouldShowParcelMapOverlay(
  source: string | undefined,
  zoom: number,
  isSearch: boolean,
) {
  if (source === 'property_buy_records') return false;
  if (source !== 'land_parcels') return false;
  if (isSearch) return true;
  return zoom >= GEOMETRY_MIN_ZOOM;
}

export function shouldIncludeGeometry(zoom: number, isSearch: boolean): boolean {
  if (isSearch) return true;
  return zoom >= GEOMETRY_MIN_ZOOM;
}
