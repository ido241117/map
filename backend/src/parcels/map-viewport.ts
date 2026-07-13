/** Zoom ≥ GEOMETRY_MIN_ZOOM → trả geometry_json (MultiPolygon) cho viewport. */
export const GEOMETRY_MIN_ZOOM = 16;

/** Phạm vi tọa độ hợp lệ cho TP.HCM (province_code 79), có margin nhỏ. */
export const HCM_LAT_MIN = 10.35;
export const HCM_LAT_MAX = 11.17;
export const HCM_LNG_MIN = 106.35;
export const HCM_LNG_MAX = 107.05;

export const VIEWPORT_GEOMETRY_LIMIT = 1200;
export const VIEWPORT_MARKER_LIMIT = 4000;

export function shouldIncludeGeometry(
  zoom: number | undefined,
  isSearch: boolean,
  includeGeometryFlag?: boolean,
): boolean {
  if (includeGeometryFlag !== undefined) return includeGeometryFlag;
  if (isSearch) return true;
  if (zoom === undefined || !Number.isFinite(zoom)) return false;
  return zoom >= GEOMETRY_MIN_ZOOM;
}
