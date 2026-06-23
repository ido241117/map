/** Zoom ≥ GEOMETRY_MIN_ZOOM → trả geometry_json (MultiPolygon) cho viewport. */
export const GEOMETRY_MIN_ZOOM = 16;

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
