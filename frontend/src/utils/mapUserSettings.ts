import type { ParcelSource } from '../types';

const SETTINGS_KEY = 'map.userSettings.v2';
const VIEWPORT_KEY = 'map.viewport.v1';

export type MapUserSettings = {
  dataSource: ParcelSource;
  district?: string;
  ward?: string;
  searchInput: string;
  committedSearch: string;
  showParcels: boolean;
  showHighways: boolean;
  showQhsdd: boolean;
};

export type MapViewport = {
  lng: number;
  lat: number;
  zoom: number;
};

const DEFAULT_SETTINGS: MapUserSettings = {
  dataSource: 'land_parcels',
  searchInput: '',
  committedSearch: '',
  showParcels: false,
  showHighways: false,
  showQhsdd: false,
};

function isParcelSource(value: unknown): value is ParcelSource {
  return value === 'land_parcels' || value === 'property_buy_records';
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function loadMapUserSettings(): MapUserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<MapUserSettings>;
    return {
      dataSource: isParcelSource(parsed.dataSource) ? parsed.dataSource : DEFAULT_SETTINGS.dataSource,
      district: asOptionalString(parsed.district),
      ward: asOptionalString(parsed.ward),
      searchInput: asString(parsed.searchInput),
      committedSearch: asString(parsed.committedSearch),
      showParcels: asBoolean(parsed.showParcels, DEFAULT_SETTINGS.showParcels),
      showHighways: asBoolean(parsed.showHighways, DEFAULT_SETTINGS.showHighways),
      showQhsdd: asBoolean(parsed.showQhsdd, DEFAULT_SETTINGS.showQhsdd),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveMapUserSettings(settings: MapUserSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota / private mode
  }
}

export function loadMapViewport(): MapViewport | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MapViewport>;
    const lng = Number(parsed.lng);
    const lat = Number(parsed.lat);
    const zoom = Number(parsed.zoom);
    if (![lng, lat, zoom].every(Number.isFinite)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    if (zoom < 0 || zoom > 22) return null;
    return { lng, lat, zoom };
  } catch {
    return null;
  }
}

export function saveMapViewport(viewport: MapViewport): void {
  try {
    localStorage.setItem(VIEWPORT_KEY, JSON.stringify(viewport));
  } catch {
    // ignore quota / private mode
  }
}
