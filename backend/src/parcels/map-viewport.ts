/** Zoom ≤ CLUSTER_MAX_ZOOM → grid clusters; zoom ≥ GEOMETRY_MIN_ZOOM → full polygons. */
export const CLUSTER_MAX_ZOOM = 15;
export const GEOMETRY_MIN_ZOOM = 16;

/** Demo viewport caps — avoid unbounded bbox loads on multi-million tables. */
export const VIEWPORT_GEOMETRY_LIMIT = 1200;
export const VIEWPORT_MARKER_LIMIT = 4000;
export const VIEWPORT_CLUSTER_LIMIT = 800;

export type MapViewportMode = 'clusters' | 'parcels';

export function mapViewportMode(zoom: number | undefined, isSearch: boolean): MapViewportMode {
  if (isSearch) return 'parcels';
  if (zoom === undefined || !Number.isFinite(zoom)) return 'parcels';
  if (zoom <= CLUSTER_MAX_ZOOM) return 'clusters';
  return 'parcels';
}

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

/** Grid cell size in degrees — ~56 screen pixels at the given zoom. */
export function gridCellDegrees(zoom: number): number {
  const targetPixels = 56;
  return (targetPixels * 360) / (256 * 2 ** zoom);
}
