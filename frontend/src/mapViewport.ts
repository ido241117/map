export const CLUSTER_MAX_ZOOM = 15;
export const GEOMETRY_MIN_ZOOM = 16;
export const QHSDD_MIN_ZOOM = 11;
/** Nhãn loại đất chỉ hiện khi zoom đủ sâu để tránh chồng chéo (vùng QHSDD vẫn từ zoom 11). */
export const QHSDD_LABEL_MIN_ZOOM = 17;

export function shouldShowQhsddOverlay(source: string | undefined, zoom: number, isSearch: boolean) {
  if (isSearch) return false;
  if (source !== 'land_parcels') return false;
  return zoom >= QHSDD_MIN_ZOOM;
}

export function shouldShowQhsddLabels(zoom: number) {
  return zoom >= QHSDD_LABEL_MIN_ZOOM;
}

export function shouldShowParcelMapOverlay(source: string | undefined, _zoom: number, isSearch: boolean) {
  if (source === 'property_buy_records') return false;
  return source === 'land_parcels';
}

export function shouldIncludeGeometry(zoom: number, isSearch: boolean): boolean {
  if (isSearch) return true;
  return zoom >= GEOMETRY_MIN_ZOOM;
}
