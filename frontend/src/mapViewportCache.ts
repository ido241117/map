import L from 'leaflet';
import { GEOMETRY_MIN_ZOOM } from './mapViewport';
import type { Parcel } from './types';

/** Extra margin for API fetch — load slightly beyond the visible screen. */
export const VIEWPORT_FETCH_PAD = 0.5;
/** Render prefetched parcels in the same padded area so panning does not show gaps. */
export const VIEWPORT_RENDER_PAD = VIEWPORT_FETCH_PAD;
/** Drop merged parcels farther than this × viewport from center. */
export const VIEWPORT_PRUNE_PAD = 1.2;
export const VIEWPORT_GEOMETRY_LIMIT = 1200;
export const VIEWPORT_MARKER_LIMIT = 4000;
export const MAP_MOVE_DEBOUNCE_MS = 450;
export const MAX_LOADED_PARCELS = 6000;

export function expandBounds(bounds: L.LatLngBounds, ratio: number): L.LatLngBounds {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const latPad = (ne.lat - sw.lat) * ratio;
  const lngPad = (ne.lng - sw.lng) * ratio;
  return L.latLngBounds(
    L.latLng(sw.lat - latPad, sw.lng - lngPad),
    L.latLng(ne.lat + latPad, ne.lng + lngPad),
  );
}

export function boundsContains(outer: L.LatLngBounds, inner: L.LatLngBounds): boolean {
  return (
    outer.getSouth() <= inner.getSouth() &&
    outer.getNorth() >= inner.getNorth() &&
    outer.getWest() <= inner.getWest() &&
    outer.getEast() >= inner.getEast()
  );
}

export function getViewportZoomBucket(zoom: number, isSearch: boolean): string {
  if (isSearch) return 'search';
  if (zoom >= GEOMETRY_MIN_ZOOM) return 'geometry';
  return 'planning';
}

export function boundsQueryPrecision(zoom: number): number {
  if (zoom >= 17) return 5;
  if (zoom >= 14) return 4;
  return 3;
}

export function boundsToQuery(bounds: L.LatLngBounds, zoom?: number) {
  const digits = zoom !== undefined ? boundsQueryPrecision(zoom) : 4;
  const format = (value: number) => value.toFixed(digits);
  return {
    minLat: format(bounds.getSouth()),
    maxLat: format(bounds.getNorth()),
    minLng: format(bounds.getWest()),
    maxLng: format(bounds.getEast()),
  };
}

export function resolveParcelLimit(showGeometry: boolean): number {
  return showGeometry ? VIEWPORT_GEOMETRY_LIMIT : VIEWPORT_MARKER_LIMIT;
}

export function parcelInBounds(parcel: Parcel, bounds: L.LatLngBounds): boolean {
  return (
    parcel.latitude >= bounds.getSouth() &&
    parcel.latitude <= bounds.getNorth() &&
    parcel.longitude >= bounds.getWest() &&
    parcel.longitude <= bounds.getEast()
  );
}

export function filterParcelsInBounds(parcels: Iterable<Parcel>, bounds: L.LatLngBounds): Parcel[] {
  const items: Parcel[] = [];
  for (const parcel of parcels) {
    if (parcelInBounds(parcel, bounds)) items.push(parcel);
  }
  return items;
}

export function pruneParcelStore(
  store: Map<number, Parcel>,
  viewBounds: L.LatLngBounds,
  maxItems = MAX_LOADED_PARCELS,
): void {
  const keepBounds = expandBounds(viewBounds, VIEWPORT_PRUNE_PAD);
  for (const [id, parcel] of store) {
    if (!parcelInBounds(parcel, keepBounds)) {
      store.delete(id);
    }
  }

  if (store.size <= maxItems) return;

  const center = viewBounds.getCenter();
  const ranked = [...store.entries()].sort(([, a], [, b]) => {
    const da = center.distanceTo([a.latitude, a.longitude]);
    const db = center.distanceTo([b.latitude, b.longitude]);
    return da - db;
  });
  store.clear();
  ranked.slice(0, maxItems).forEach(([id, parcel]) => store.set(id, parcel));
}

export function mergeParcelsIntoStore(store: Map<number, Parcel>, items: Parcel[]): void {
  for (const parcel of items) {
    store.set(parcel.id, parcel);
  }
}
