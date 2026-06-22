import L from 'leaflet';
import { CLUSTER_MAX_ZOOM } from './mapViewport';
import type { Parcel } from './types';

/** Extra margin around the viewport — small pans reuse cached data. */
export const VIEWPORT_FETCH_PAD = 0.4;
/** Drop merged parcels farther than this × viewport from center. */
export const VIEWPORT_PRUNE_PAD = 1.2;
export const VIEWPORT_GEOMETRY_LIMIT = 1200;
export const VIEWPORT_MARKER_LIMIT = 4000;
export const VIEWPORT_CLUSTER_LIMIT = 800;
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
  if (zoom <= CLUSTER_MAX_ZOOM) return 'clusters';
  return 'geometry';
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

export function resolveParcelLimit(showGeometry: boolean, mode: 'clusters' | 'parcels'): number {
  if (mode === 'clusters') return VIEWPORT_CLUSTER_LIMIT;
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
