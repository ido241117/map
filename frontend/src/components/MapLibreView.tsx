import { useEffect, useRef } from 'react';
import maplibregl, {
  type FilterSpecification,
  type GeoJSONSource,
  type Map,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import {
  fetchAdminBounds,
  fetchParcelById,
  fetchParcels,
  fetchPropertyBuyMapPoints,
  type ParcelQuery,
} from '../api';
import {
  HCM_CENTER,
  HIGHWAYS_LAYER,
  HIGHWAYS_MAX_TILE_ZOOM,
  HIGHWAYS_MIN_ZOOM,
  LAND_PARCELS_LAYER,
  LAND_PARCELS_MAX_TILE_ZOOM,
  QHSDD_LAYER,
  QHSDD_MAX_TILE_ZOOM,
  QHSDD_MIN_ZOOM,
  RAILWAYS_LAYER,
  RAILWAYS_MAX_TILE_ZOOM,
  RAILWAYS_MIN_ZOOM,
  RAILWAYS_STATIONS_MIN_ZOOM,
  highwaysTileUrl,
  landParcelsTileUrl,
  qhsddTileUrl,
  railwaysTileUrl,
} from '../utils/mapTiles';
import { loadMapViewport, saveMapViewport } from '../utils/mapUserSettings';
import { metroLine1StationsGeoJson } from '../constants/metroLine1Stations';
import { METRO_LINE2_FILTER, METRO_LINE2_INFO } from '../constants/metroLine2';
import {
  metroPlanStationsGeoJson,
  metroPlanTodGeoJson,
} from '../constants/metroPlan';
import {
  ensureMapMvtProtocol,
  notifyMapInteractionEnd,
  notifyMapInteractionStart,
  subscribeTileLoaderStatus,
  type TileLoaderStatus,
} from '../utils/mapTileLoader';
import { GEOMETRY_MIN_ZOOM, HOUSE_NO_LABEL_MIN_ZOOM, QHSDD_LABEL_MIN_ZOOM } from '../utils/mapViewport';
import { isUsableStreetSearchQuery } from '../utils/searchQuery';
import { parcelEdgeLabelsToGeoJson } from '../utils/parcelEdgeLabels';
import { extractHouseNo } from '../utils/parcelHouseNo';
import type { Parcel, ParcelSource } from '../types';

const METRO_PLAN_FILTER: FilterSpecification = ['==', ['get', 'railway'], 'metro_plan'];
export type MapLibreUpdate = {
  zoom: number;
  visibleParcels: number;
  visibleQhsdd: number;
  searchReturned?: number;
  truncated?: boolean;
  propertyBuyCount?: number;
};

type MapLibreViewProps = {
  dataSource: ParcelSource;
  filters: Omit<ParcelQuery, 'minLat' | 'maxLat' | 'minLng' | 'maxLng' | 'includeGeometry' | 'source'>;
  filtersVersion: string;
  searchQuery?: string;
  focusTarget?: { lat: number; lng: number; zoom?: number; key: string } | null;
  showParcels?: boolean;
  showHighways?: boolean;
  showRailways?: boolean;
  showQhsdd?: boolean;
  onUpdate: (info: MapLibreUpdate) => void;
  onError: (message: string) => void;
  onReady: () => void;
  onTileStatus?: (status: TileLoaderStatus) => void;
};

const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO';

function formatNumber(value: number | string | undefined) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

function escapeHtml(value: string | null | undefined) {
  const text = value ?? '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function popupHtml(parcel: Parcel) {
  const location = [parcel.ward, parcel.district].filter(Boolean).join(', ');
  return `
    <div class="parcel-popup popup">
      <strong>${escapeHtml(parcel.address || 'Thửa đất')}</strong>
      <div>Diện tích: ${formatNumber(parcel.total_area)} m²</div>
      <div>Loại đất: ${escapeHtml(parcel.planning_land_type || '—')}</div>
      ${location ? `<div>${escapeHtml(location)}</div>` : ''}
    </div>
  `;
}

function propertyBuyPopupHtml(item: {
  string?: string | null;
  address?: string;
  record_id: number;
  lat: number;
  long: number;
}) {
  return `
    <div class="popup">
      <strong>${escapeHtml(item.string || item.address || `Record #${item.record_id}`)}</strong>
      <span>Record: ${item.record_id}</span>
      <span>Tọa độ: ${item.lat.toFixed(6)}, ${item.long.toFixed(6)}</span>
    </div>
  `;
}

function metroStationPopupHtml(props: {
  name?: string;
  order?: number;
  level?: string;
}) {
  const levelLabel =
    props.level === 'underground'
      ? 'Ga ngầm'
      : props.level === 'elevated'
        ? 'Ga trên cao'
        : null;
  const order =
    typeof props.order === 'number' && Number.isFinite(props.order)
      ? `Ga ${props.order}/14`
      : null;
  return `
    <div class="popup metro-station-popup">
      <strong>${escapeHtml(props.name || 'Nhà ga')}</strong>
      <span>Tuyến metro số 1 (Bến Thành – Suối Tiên)</span>
      ${order ? `<span>${escapeHtml(order)}</span>` : ''}
      ${levelLabel ? `<span>${escapeHtml(levelLabel)}</span>` : ''}
    </div>
  `;
}

function metroLine2PopupHtml() {
  const km = METRO_LINE2_INFO.lengthKm.toLocaleString('vi-VN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `
    <div class="popup metro-line2-popup">
      <strong>${escapeHtml(METRO_LINE2_INFO.name)}</strong>
      <span>Dài khoảng ${escapeHtml(km)} km</span>
      <span>${METRO_LINE2_INFO.stations} nhà ga (${escapeHtml(METRO_LINE2_INFO.stationsDetail)})</span>
      <span>${escapeHtml(METRO_LINE2_INFO.status)}</span>
    </div>
  `;
}

function metroPlanStationPopupHtml(props: {
  name?: string;
  line?: string;
  route?: string;
  description?: string;
}) {
  const line = props.line?.trim();
  const route = props.route?.trim();
  const description = props.description?.trim();
  return `
    <div class="popup metro-plan-station-popup">
      <strong>${escapeHtml(props.name || 'Nhà ga')}</strong>
      ${line ? `<span>${escapeHtml(line)}</span>` : ''}
      ${route ? `<span>${escapeHtml(route)}</span>` : ''}
      ${description && description !== ' ' ? `<span>${escapeHtml(description)}</span>` : ''}
    </div>
  `;
}

function metroPlanLinePopupHtml(props: { name?: string; ref?: string; layer?: string }) {
  const route = props.layer?.trim() || props.ref?.trim();
  return `
    <div class="popup metro-plan-line-popup">
      <strong>${escapeHtml(props.name || 'Tuyến quy hoạch')}</strong>
      ${route ? `<span>${escapeHtml(route)}</span>` : ''}
    </div>
  `;
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function parcelsToGeoJson(parcels: Parcel[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const parcel of parcels) {
    if (!parcel.geometry_json) continue;
    features.push({
      type: 'Feature',
      properties: { id: parcel.id },
      geometry: parcel.geometry_json,
    });
    const houseNo = extractHouseNo(parcel.address);
    if (
      houseNo &&
      Number.isFinite(parcel.longitude) &&
      Number.isFinite(parcel.latitude)
    ) {
      features.push({
        type: 'Feature',
        properties: { id: parcel.id, house_no: houseNo },
        geometry: {
          type: 'Point',
          coordinates: [parcel.longitude, parcel.latitude],
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function setSelectedParcelSources(map: Map, parcel: Parcel | null) {
  if (!parcel?.geometry_json) {
    setGeoJsonSource(map, 'selected-parcel', emptyFeatureCollection());
    setGeoJsonSource(map, 'selected-parcel-edges', emptyFeatureCollection());
    return;
  }
  setGeoJsonSource(map, 'selected-parcel', parcelToGeoJson(parcel));
  setGeoJsonSource(map, 'selected-parcel-edges', parcelEdgeLabelsToGeoJson(parcel.geometry_json));
}

function clearSelectedParcel(map: Map) {
  setSelectedParcelSources(map, null);
}

function parcelToGeoJson(parcel: Parcel): GeoJSON.FeatureCollection {
  if (!parcel.geometry_json) return emptyFeatureCollection();
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { id: parcel.id },
        geometry: parcel.geometry_json,
      },
    ],
  };
}

function boundsFromParcels(parcels: Parcel[]): maplibregl.LngLatBoundsLike | null {
  const coords: [number, number][] = [];
  for (const parcel of parcels) {
    if (Number.isFinite(parcel.longitude) && Number.isFinite(parcel.latitude)) {
      coords.push([parcel.longitude, parcel.latitude]);
    }
  }
  if (!coords.length) return null;
  const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
  for (const coord of coords.slice(1)) {
    bounds.extend(coord);
  }
  return bounds;
}

function setGeoJsonSource(map: Map, sourceId: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
  }
}

function setLayerVisibility(map: Map, layerId: string, visible: boolean) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function countRenderedParcels(map: Map) {
  const layers = ['parcel-fill', 'search-parcel-fill'].filter((id) => map.getLayer(id));
  if (!layers.length) return 0;
  try {
    return map.queryRenderedFeatures({ layers }).length;
  } catch {
    return 0;
  }
}

function countRenderedQhsdd(map: Map) {
  if (!map.getLayer('qhsdd-fill')) return 0;
  try {
    return map.queryRenderedFeatures({ layers: ['qhsdd-fill'] }).length;
  } catch {
    return 0;
  }
}

function emitUpdate(map: Map, onUpdate: (info: MapLibreUpdate) => void, extra?: Partial<MapLibreUpdate>) {
  onUpdate({
    zoom: Math.round(map.getZoom() * 10) / 10,
    visibleParcels: countRenderedParcels(map),
    visibleQhsdd: countRenderedQhsdd(map),
    ...extra,
  });
}

function syncLayerVisibility(
  map: Map,
  dataSource: ParcelSource,
  searchQuery: string,
  showParcels: boolean,
  showHighways: boolean,
  showRailways: boolean,
  showQhsdd: boolean,
) {
  const isSearch = Boolean(searchQuery.trim());
  const showLandLayers = dataSource === 'land_parcels';
  const isPropertyBuy = dataSource === 'property_buy_records';

  // Ẩn QHSDD khi đang tìm thửa theo tên đường (Elasticsearch) — khớp MapDataLayer.
  const showQhsddLayer = showLandLayers && showQhsdd && !isSearch;
  setLayerVisibility(map, 'qhsdd-fill', showQhsddLayer);
  setLayerVisibility(map, 'qhsdd-line', showQhsddLayer);
  setLayerVisibility(map, 'qhsdd-label', showQhsddLayer);
  setLayerVisibility(map, 'parcel-fill', showLandLayers && showParcels && !isSearch);
  setLayerVisibility(map, 'parcel-line', showLandLayers && showParcels && !isSearch);
  // Non-interactive overlays — controlled by separate checkboxes.
  setLayerVisibility(map, 'highways-line', showLandLayers && showHighways);
  setLayerVisibility(map, 'railways-metro-plan-tod', showLandLayers && showRailways);
  setLayerVisibility(map, 'railways-metro-plan-glow', showLandLayers && showRailways);
  setLayerVisibility(map, 'railways-metro-plan', showLandLayers && showRailways);
  setLayerVisibility(map, 'railways-metro-plan-hit', showLandLayers && showRailways);
  setLayerVisibility(map, 'railways-line', showLandLayers && showRailways);
  setLayerVisibility(map, 'railways-subway-glow', showLandLayers && showRailways);
  setLayerVisibility(map, 'railways-subway', showLandLayers && showRailways);
  setLayerVisibility(map, 'railways-l2-glow', showLandLayers && showRailways);
  setLayerVisibility(map, 'railways-l2', showLandLayers && showRailways);
  setLayerVisibility(map, 'railways-l2-hit', showLandLayers && showRailways);
  setLayerVisibility(map, 'railways-metro-plan-station', showLandLayers && showRailways);
  setLayerVisibility(map, 'railways-station', showLandLayers && showRailways);
  setLayerVisibility(map, 'search-parcel-fill', showLandLayers && showParcels && isSearch);
  setLayerVisibility(map, 'search-parcel-line', showLandLayers && showParcels && isSearch);
  setLayerVisibility(map, 'selected-parcel-fill', showLandLayers && showParcels);
  setLayerVisibility(map, 'selected-parcel-line', showLandLayers && showParcels);
  setLayerVisibility(map, 'selected-parcel-edge-label', showLandLayers && showParcels);
  setLayerVisibility(map, 'parcel-house-label', showLandLayers && showParcels && !isSearch);
  setLayerVisibility(map, 'search-parcel-house-label', showLandLayers && showParcels && isSearch);
  setLayerVisibility(map, 'property-buy-circles', isPropertyBuy);
}

const QHSDD_LABEL_BASE_FILTER = [
  'all',
  ['has', 'loai_dat_quy_hoach'],
  ['!=', ['get', 'loai_dat_quy_hoach'], ''],
] as maplibregl.FilterSpecification;

const HOUSE_NO_LABEL_FILTER = [
  'all',
  ['has', 'house_no'],
  ['!=', ['to-string', ['get', 'house_no']], ''],
] as maplibregl.FilterSpecification;

const HOUSE_NO_LABEL_LAYOUT: maplibregl.SymbolLayerSpecification['layout'] = {
  'text-field': ['to-string', ['get', 'house_no']],
  'text-font': ['Noto Sans Medium'],
  'text-size': 11,
  'text-anchor': 'center',
  'text-allow-overlap': true,
  'text-ignore-placement': true,
  'text-padding': 0,
};

const HOUSE_NO_LABEL_PAINT: maplibregl.SymbolLayerSpecification['paint'] = {
  'text-color': '#14532d',
  'text-halo-color': '#ffffff',
  'text-halo-width': 1.5,
};

function hasAdminFilter(filters: { district?: string; ward?: string }) {
  return Boolean(filters.district?.trim() || filters.ward?.trim());
}

function adminTileFilter(
  filters: { district?: string; ward?: string },
): { district?: string; ward?: string } | undefined {
  return hasAdminFilter(filters) ? filters : undefined;
}

function layerVisibility(visible: boolean): 'visible' | 'none' {
  return visible ? 'visible' : 'none';
}

function syncTileSources(
  map: Map,
  showParcels: boolean,
  showHighways: boolean,
  showRailways: boolean,
  showQhsdd: boolean,
  filters: { district?: string; ward?: string },
  tileUrlCache?: {
    parcels: string | null;
    highways: string | null;
    railways: string | null;
    qhsdd: string | null;
  },
) {
  const admin = adminTileFilter(filters);
  const parcels = map.getSource('parcels') as maplibregl.VectorTileSource | undefined;
  if (parcels && typeof parcels.setTiles === 'function') {
    if (showParcels) {
      const url = landParcelsTileUrl(admin);
      if (tileUrlCache?.parcels !== url) {
        parcels.setTiles([url]);
        if (tileUrlCache) tileUrlCache.parcels = url;
      }
    } else if (tileUrlCache?.parcels !== null) {
      parcels.setTiles([]);
      if (tileUrlCache) tileUrlCache.parcels = null;
    }
  }

  const highways = map.getSource('highways') as maplibregl.VectorTileSource | undefined;
  if (highways && typeof highways.setTiles === 'function') {
    if (showHighways) {
      const url = highwaysTileUrl();
      if (tileUrlCache?.highways !== url) {
        highways.setTiles([url]);
        if (tileUrlCache) tileUrlCache.highways = url;
      }
    } else if (tileUrlCache?.highways !== null) {
      highways.setTiles([]);
      if (tileUrlCache) tileUrlCache.highways = null;
    }
  }

  const railways = map.getSource('railways') as maplibregl.VectorTileSource | undefined;
  if (railways && typeof railways.setTiles === 'function') {
    if (showRailways) {
      const url = railwaysTileUrl();
      if (tileUrlCache?.railways !== url) {
        railways.setTiles([url]);
        if (tileUrlCache) tileUrlCache.railways = url;
      }
    } else if (tileUrlCache?.railways !== null) {
      railways.setTiles([]);
      if (tileUrlCache) tileUrlCache.railways = null;
    }
  }

  const qhsdd = map.getSource('qhsdd') as maplibregl.VectorTileSource | undefined;
  if (qhsdd && typeof qhsdd.setTiles === 'function') {
    if (showQhsdd) {
      const url = qhsddTileUrl(admin);
      if (tileUrlCache?.qhsdd !== url) {
        qhsdd.setTiles([url]);
        if (tileUrlCache) tileUrlCache.qhsdd = url;
      }
    } else if (tileUrlCache?.qhsdd !== null) {
      qhsdd.setTiles([]);
      if (tileUrlCache) tileUrlCache.qhsdd = null;
    }
  }
}

function buildMapStyle(opts: {
  showParcels: boolean;
  showHighways: boolean;
  showRailways: boolean;
  showQhsdd: boolean;
  isSearch: boolean;
  parcelTiles: string[];
  qhsddTiles: string[];
  highwayTiles: string[];
  railwayTiles: string[];
}): maplibregl.StyleSpecification {
  const showParcelTiles = opts.showParcels && !opts.isSearch;
  const showSearchParcels = opts.showParcels && opts.isSearch;
  const parcelsVis = layerVisibility(showParcelTiles);
  const searchParcelsVis = layerVisibility(showSearchParcels);
  const selectedParcelsVis = layerVisibility(opts.showParcels);
  const highwaysVis = layerVisibility(opts.showHighways);
  const railwaysVis = layerVisibility(opts.showRailways);
  const qhsddVis = layerVisibility(opts.showQhsdd && !opts.isSearch);

  return {
    version: 8,
    // demotiles Bold fontstack 404s → broken Vietnamese labels
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sources: {
      basemap: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: BASEMAP_ATTRIBUTION,
      },
      qhsdd: {
        type: 'vector',
        tiles: opts.qhsddTiles,
        minzoom: QHSDD_MIN_ZOOM,
        maxzoom: QHSDD_MAX_TILE_ZOOM,
      },
      parcels: {
        type: 'vector',
        tiles: opts.parcelTiles,
        minzoom: GEOMETRY_MIN_ZOOM,
        maxzoom: LAND_PARCELS_MAX_TILE_ZOOM,
      },
      highways: {
        type: 'vector',
        tiles: opts.highwayTiles,
        minzoom: HIGHWAYS_MIN_ZOOM,
        maxzoom: HIGHWAYS_MAX_TILE_ZOOM,
      },
      railways: {
        type: 'vector',
        tiles: opts.railwayTiles,
        minzoom: RAILWAYS_MIN_ZOOM,
        maxzoom: RAILWAYS_MAX_TILE_ZOOM,
      },
      'metro-line1-stations': {
        type: 'geojson',
        data: metroLine1StationsGeoJson(),
      },
      'metro-plan-stations': {
        type: 'geojson',
        data: metroPlanStationsGeoJson(),
      },
      'metro-plan-tod': {
        type: 'geojson',
        data: metroPlanTodGeoJson(),
      },
      'search-parcels': {
        type: 'geojson',
        data: emptyFeatureCollection(),
      },
      'selected-parcel': {
        type: 'geojson',
        data: emptyFeatureCollection(),
      },
      'selected-parcel-edges': {
        type: 'geojson',
        data: emptyFeatureCollection(),
      },
      'property-buy-points': {
        type: 'geojson',
        data: emptyFeatureCollection(),
      },
    },
    layers: [
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
      },
      {
        id: 'qhsdd-fill',
        type: 'fill',
        source: 'qhsdd',
        'source-layer': QHSDD_LAYER,
        minzoom: QHSDD_MIN_ZOOM,
        layout: { visibility: qhsddVis },
        paint: {
          'fill-color': ['coalesce', ['get', 'fill_hex'], '#94a3b8'],
          'fill-opacity': 0.42,
        },
      },
      {
        id: 'qhsdd-line',
        type: 'line',
        source: 'qhsdd',
        'source-layer': QHSDD_LAYER,
        minzoom: QHSDD_MIN_ZOOM,
        layout: { visibility: qhsddVis },
        paint: {
          'line-color': ['coalesce', ['get', 'fill_hex'], '#94a3b8'],
          'line-opacity': 0.78,
          'line-width': 0.8,
        },
      },
      {
        id: 'qhsdd-label',
        type: 'symbol',
        source: 'qhsdd',
        'source-layer': QHSDD_LAYER,
        minzoom: QHSDD_LABEL_MIN_ZOOM,
        filter: QHSDD_LABEL_BASE_FILTER,
        layout: {
          visibility: qhsddVis,
          'text-field': ['get', 'loai_dat_quy_hoach'],
          'text-font': ['Noto Sans Medium'],
          'text-size': 11,
          'text-max-width': 14,
          'text-anchor': 'center',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
      },
      {
        id: 'parcel-fill',
        type: 'fill',
        source: 'parcels',
        'source-layer': LAND_PARCELS_LAYER,
        minzoom: GEOMETRY_MIN_ZOOM,
        layout: { visibility: parcelsVis },
        paint: {
          'fill-color': '#22c55e',
          'fill-opacity': 0.28,
        },
      },
      {
        id: 'parcel-line',
        type: 'line',
        source: 'parcels',
        'source-layer': LAND_PARCELS_LAYER,
        minzoom: GEOMETRY_MIN_ZOOM,
        layout: { visibility: parcelsVis },
        paint: {
          'line-color': '#14532d',
          'line-opacity': 0.82,
          'line-width': 1,
        },
      },
      // Drawn above parcel fill/outline; click still hits parcel-fill (layer-scoped events).
      {
        id: 'highways-line',
        type: 'line',
        source: 'highways',
        'source-layer': HIGHWAYS_LAYER,
        minzoom: HIGHWAYS_MIN_ZOOM,
        layout: {
          visibility: highwaysVis,
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': [
            'match',
            ['get', 'highway'],
            'motorway',
            '#1e3a5f',
            'trunk',
            '#1e3a5f',
            'primary',
            '#334155',
            'secondary',
            '#475569',
            'tertiary',
            '#64748b',
            '#94a3b8',
          ],
          'line-opacity': 0.95,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15,
            [
              'match',
              ['get', 'highway'],
              'motorway',
              3,
              'trunk',
              2.8,
              'primary',
              2.4,
              'secondary',
              2,
              'tertiary',
              1.7,
              1.4,
            ],
            18,
            [
              'match',
              ['get', 'highway'],
              'motorway',
              5.5,
              'trunk',
              5,
              'primary',
              4.2,
              'secondary',
              3.4,
              'tertiary',
              2.8,
              2,
            ],
          ],
        },
      },
      {
        id: 'railways-metro-plan-tod',
        type: 'fill',
        source: 'metro-plan-tod',
        minzoom: RAILWAYS_MIN_ZOOM,
        layout: {
          visibility: railwaysVis,
        },
        paint: {
          'fill-color': '#0284c7',
          'fill-opacity': 0.12,
        },
      },
      {
        id: 'railways-metro-plan-glow',
        type: 'line',
        source: 'railways',
        'source-layer': RAILWAYS_LAYER,
        minzoom: RAILWAYS_MIN_ZOOM,
        filter: METRO_PLAN_FILTER,
        layout: {
          visibility: railwaysVis,
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': ['coalesce', ['get', 'service'], '#64748b'],
          'line-opacity': 0.22,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            3,
            8,
            4.5,
            10,
            5,
            14,
            9,
            18,
            14,
          ],
        },
      },
      {
        id: 'railways-metro-plan',
        type: 'line',
        source: 'railways',
        'source-layer': RAILWAYS_LAYER,
        minzoom: RAILWAYS_MIN_ZOOM,
        filter: METRO_PLAN_FILTER,
        layout: {
          visibility: railwaysVis,
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': ['coalesce', ['get', 'service'], '#64748b'],
          'line-opacity': 0.9,
          'line-dasharray': [1.2, 1.6],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            2.2,
            8,
            2.4,
            10,
            2.6,
            14,
            3,
            18,
            4.5,
          ],
        },
      },
      {
        id: 'railways-metro-plan-hit',
        type: 'line',
        source: 'railways',
        'source-layer': RAILWAYS_LAYER,
        minzoom: RAILWAYS_MIN_ZOOM,
        filter: METRO_PLAN_FILTER,
        layout: {
          visibility: railwaysVis,
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#64748b',
          'line-opacity': 0,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            10,
            10,
            12,
            14,
            16,
            18,
            22,
          ],
        },
      },
      {
        id: 'railways-subway-glow',
        type: 'line',
        source: 'railways',
        'source-layer': RAILWAYS_LAYER,
        minzoom: RAILWAYS_MIN_ZOOM,
        filter: ['==', ['get', 'railway'], 'subway'],
        layout: {
          visibility: railwaysVis,
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#ef4444',
          'line-opacity': 0.28,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            4,
            8,
            5,
            10,
            6,
            14,
            10,
            18,
            16,
          ],
        },
      },
      {
        id: 'railways-subway',
        type: 'line',
        source: 'railways',
        'source-layer': RAILWAYS_LAYER,
        minzoom: RAILWAYS_MIN_ZOOM,
        filter: ['==', ['get', 'railway'], 'subway'],
        layout: {
          visibility: railwaysVis,
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#dc2626',
          'line-opacity': 1,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            2,
            8,
            2.2,
            10,
            2.4,
            14,
            4,
            18,
            6.5,
          ],
        },
      },
      {
        id: 'railways-l2-glow',
        type: 'line',
        source: 'railways',
        'source-layer': RAILWAYS_LAYER,
        minzoom: RAILWAYS_MIN_ZOOM,
        filter: METRO_LINE2_FILTER,
        layout: {
          visibility: railwaysVis,
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#38bdf8',
          'line-opacity': 0.3,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            4,
            8,
            5,
            10,
            6,
            14,
            10,
            18,
            16,
          ],
        },
      },
      {
        id: 'railways-l2',
        type: 'line',
        source: 'railways',
        'source-layer': RAILWAYS_LAYER,
        minzoom: RAILWAYS_MIN_ZOOM,
        filter: METRO_LINE2_FILTER,
        layout: {
          visibility: railwaysVis,
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#0284c7',
          'line-opacity': 0.95,
          'line-dasharray': [2, 1.4],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            2,
            8,
            2.1,
            10,
            2.2,
            14,
            3.6,
            18,
            5.5,
          ],
        },
      },
      {
        // Vùng click rộng hơn nét vẽ
        id: 'railways-l2-hit',
        type: 'line',
        source: 'railways',
        'source-layer': RAILWAYS_LAYER,
        minzoom: RAILWAYS_MIN_ZOOM,
        filter: METRO_LINE2_FILTER,
        layout: {
          visibility: railwaysVis,
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#0284c7',
          'line-opacity': 0,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            12,
            10,
            14,
            14,
            18,
            18,
            24,
          ],
        },
      },
      {
        id: 'railways-line',
        type: 'line',
        source: 'railways',
        'source-layer': RAILWAYS_LAYER,
        minzoom: RAILWAYS_MIN_ZOOM,
        filter: [
          'all',
          ['!=', ['get', 'railway'], 'subway'],
          ['!=', ['get', 'railway'], 'metro_plan'],
          ['!', METRO_LINE2_FILTER],
        ],
        layout: {
          visibility: railwaysVis,
          'line-cap': 'butt',
          'line-join': 'round',
        },
        paint: {
          'line-color': [
            'match',
            ['get', 'railway'],
            'rail',
            '#292524',
            'light_rail',
            '#b45309',
            'tram',
            '#a16207',
            'construction',
            '#f97316',
            'proposed',
            '#94a3b8',
            '#57534e',
          ],
          'line-opacity': [
            'match',
            ['get', 'railway'],
            'proposed',
            0.55,
            0.9,
          ],
          'line-dasharray': [
            'match',
            ['get', 'railway'],
            'construction',
            ['literal', [1.5, 1.5]],
            'proposed',
            ['literal', [1, 2]],
            ['literal', [2, 1.2]],
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0,
            [
              'match',
              ['get', 'railway'],
              'rail',
              1.4,
              'construction',
              1.6,
              1.2,
            ],
            8,
            [
              'match',
              ['get', 'railway'],
              'rail',
              1.3,
              'construction',
              1.5,
              1.1,
            ],
            10,
            [
              'match',
              ['get', 'railway'],
              'rail',
              1.2,
              'construction',
              1.4,
              1,
            ],
            14,
            [
              'match',
              ['get', 'railway'],
              'rail',
              2,
              'construction',
              2.2,
              1.6,
            ],
            18,
            [
              'match',
              ['get', 'railway'],
              'rail',
              3.2,
              'construction',
              3.4,
              2.4,
            ],
          ],
        },
      },
      {
        id: 'railways-metro-plan-station',
        type: 'circle',
        source: 'metro-plan-stations',
        minzoom: RAILWAYS_STATIONS_MIN_ZOOM,
        layout: {
          visibility: railwaysVis,
        },
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            3,
            14,
            4.5,
            18,
            6,
          ],
          'circle-color': ['coalesce', ['get', 'color'], '#64748b'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.2,
          'circle-opacity': 0.9,
        },
      },
      {
        id: 'railways-station',
        type: 'circle',
        source: 'metro-line1-stations',
        minzoom: RAILWAYS_STATIONS_MIN_ZOOM,
        layout: {
          visibility: railwaysVis,
        },
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            5,
            14,
            7,
            18,
            9,
          ],
          'circle-color': [
            'match',
            ['get', 'level'],
            'underground',
            '#dc2626',
            '#ffffff',
          ],
          'circle-stroke-color': '#dc2626',
          'circle-stroke-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            2,
            14,
            2.5,
            18,
            3,
          ],
          'circle-opacity': 0.96,
        },
      },
      {
        id: 'search-parcel-fill',
        type: 'fill',
        source: 'search-parcels',
        layout: { visibility: searchParcelsVis },
        paint: {
          'fill-color': '#22c55e',
          'fill-opacity': 0.35,
        },
      },
      {
        id: 'search-parcel-line',
        type: 'line',
        source: 'search-parcels',
        layout: { visibility: searchParcelsVis },
        paint: {
          'line-color': '#14532d',
          'line-width': 1.2,
        },
      },
      {
        id: 'selected-parcel-fill',
        type: 'fill',
        source: 'selected-parcel',
        layout: { visibility: selectedParcelsVis },
        paint: {
          'fill-color': '#fb7185',
          'fill-opacity': 0.25,
        },
      },
      {
        id: 'selected-parcel-line',
        type: 'line',
        source: 'selected-parcel',
        layout: { visibility: selectedParcelsVis },
        paint: {
          'line-color': '#e11d48',
          'line-width': 2,
        },
      },
      // house_no lives on polygon features; labeling polygons survives overzoom better than
      // MVT point buckets under MapLibre 5. Centroid layer still shipped for future use.
      {
        id: 'parcel-house-label',
        type: 'symbol',
        source: 'parcels',
        'source-layer': LAND_PARCELS_LAYER,
        minzoom: HOUSE_NO_LABEL_MIN_ZOOM,
        filter: HOUSE_NO_LABEL_FILTER,
        layout: { ...HOUSE_NO_LABEL_LAYOUT, visibility: parcelsVis },
        paint: HOUSE_NO_LABEL_PAINT,
      },
      {
        id: 'search-parcel-house-label',
        type: 'symbol',
        source: 'search-parcels',
        minzoom: HOUSE_NO_LABEL_MIN_ZOOM,
        filter: HOUSE_NO_LABEL_FILTER,
        layout: { ...HOUSE_NO_LABEL_LAYOUT, visibility: searchParcelsVis },
        paint: HOUSE_NO_LABEL_PAINT,
      },
      {
        id: 'selected-parcel-edge-label',
        type: 'symbol',
        source: 'selected-parcel-edges',
        layout: {
          visibility: selectedParcelsVis,
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Medium'],
          'text-size': 12,
          'text-rotate': ['get', 'angle'],
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-anchor': 'center',
        },
        paint: {
          'text-color': '#9f1239',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
        },
      },
      {
        id: 'property-buy-circles',
        type: 'circle',
        source: 'property-buy-points',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 5,
          'circle-color': '#f97316',
          'circle-stroke-color': '#9a3412',
          'circle-stroke-width': 1,
          'circle-opacity': 0.95,
        },
      },
    ],
  };
}

export function MapLibreView({
  dataSource,
  filters,
  filtersVersion,
  searchQuery = '',
  focusTarget = null,
  showParcels = false,
  showHighways = false,
  showRailways = false,
  showQhsdd = false,
  onUpdate,
  onError,
  onReady,
  onTileStatus,
}: MapLibreViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const onTileStatusRef = useRef(onTileStatus);
  const dataSourceRef = useRef(dataSource);
  const filtersRef = useRef(filters);
  const searchQueryRef = useRef(searchQuery);
  const showParcelsRef = useRef(showParcels);
  const showHighwaysRef = useRef(showHighways);
  const showRailwaysRef = useRef(showRailways);
  const showQhsddRef = useRef(showQhsdd);
  const tileUrlCacheRef = useRef({
    parcels: null as string | null,
    highways: null as string | null,
    railways: null as string | null,
    qhsdd: null as string | null,
  });

  onUpdateRef.current = onUpdate;
  onErrorRef.current = onError;
  onReadyRef.current = onReady;
  onTileStatusRef.current = onTileStatus;
  dataSourceRef.current = dataSource;
  filtersRef.current = filters;
  searchQueryRef.current = searchQuery;
  showParcelsRef.current = showParcels;
  showHighwaysRef.current = showHighways;
  showRailwaysRef.current = showRailways;
  showQhsddRef.current = showQhsdd;

  useEffect(() => {
    if (!onTileStatus) return;
    return subscribeTileLoaderStatus((status) => onTileStatusRef.current?.(status));
  }, [onTileStatus]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    ensureMapMvtProtocol();

    const savedView = loadMapViewport();
    const admin = adminTileFilter(filtersRef.current);
    const showParcelsInit = showParcelsRef.current;
    const showHighwaysInit = showHighwaysRef.current;
    const showRailwaysInit = showRailwaysRef.current;
    const showQhsddInit = showQhsddRef.current;
    const isSearchInit = Boolean(searchQueryRef.current.trim());
    const parcelUrl = showParcelsInit && !isSearchInit ? landParcelsTileUrl(admin) : null;
    const qhsddUrl = showQhsddInit && !isSearchInit ? qhsddTileUrl(admin) : null;
    const highwayUrl = showHighwaysInit ? highwaysTileUrl() : null;
    const railwayUrl = showRailwaysInit ? railwaysTileUrl() : null;
    tileUrlCacheRef.current = {
      parcels: parcelUrl,
      highways: highwayUrl,
      railways: railwayUrl,
      qhsdd: qhsddUrl,
    };

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle({
        showParcels: showParcelsInit,
        showHighways: showHighwaysInit,
        showRailways: showRailwaysInit,
        showQhsdd: showQhsddInit,
        isSearch: isSearchInit,
        parcelTiles: parcelUrl ? [parcelUrl] : [],
        qhsddTiles: qhsddUrl ? [qhsddUrl] : [],
        highwayTiles: highwayUrl ? [highwayUrl] : [],
        railwayTiles: railwayUrl ? [railwayUrl] : [],
      }),
      center: savedView ? [savedView.lng, savedView.lat] : HCM_CENTER,
      zoom: savedView?.zoom ?? 17,
      attributionControl: { compact: true },
      // Drop stale zoom-level requests so pans/zooms do not pile up behind the tunnel.
      cancelPendingTileRequestsWhileZooming: true,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    mapRef.current = map;

    const handleParcelClick = async (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const rawId = feature?.properties?.id;
      const id = Number(rawId);
      if (!Number.isFinite(id)) return;

      popupRef.current?.remove();
      try {
        const parcel = await fetchParcelById(id, 'land_parcels');
        setSelectedParcelSources(map, parcel);
        popupRef.current = new maplibregl.Popup({ maxWidth: '320px', closeOnClick: true })
          .setLngLat(event.lngLat)
          .setHTML(popupHtml(parcel))
          .addTo(map);
      } catch (error) {
        onErrorRef.current(error instanceof Error ? error.message : 'Không tải được chi tiết thửa');
      }
    };

    const handlePropertyBuyClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature?.geometry || feature.geometry.type !== 'Point') return;
      const [lng, lat] = feature.geometry.coordinates;
      const props = feature.properties ?? {};
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ maxWidth: '320px', closeOnClick: true })
        .setLngLat([lng, lat])
        .setHTML(
          propertyBuyPopupHtml({
            string: props.string as string | null,
            address: props.address as string,
            record_id: Number(props.record_id),
            lat,
            long: lng,
          }),
        )
        .addTo(map);
    };

    const handleMetroStationClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature?.geometry || feature.geometry.type !== 'Point') return;
      const [lng, lat] = feature.geometry.coordinates;
      const props = feature.properties ?? {};
      event.originalEvent.stopPropagation();
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ maxWidth: '280px', closeOnClick: true })
        .setLngLat([lng, lat])
        .setHTML(
          metroStationPopupHtml({
            name: props.name as string | undefined,
            order: Number(props.order),
            level: props.level as string | undefined,
          }),
        )
        .addTo(map);
    };

    const handleMetroLine2Click = (event: MapLayerMouseEvent) => {
      event.originalEvent.stopPropagation();
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ maxWidth: '300px', closeOnClick: true })
        .setLngLat(event.lngLat)
        .setHTML(metroLine2PopupHtml())
        .addTo(map);
    };

    const handleMetroPlanStationClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature?.geometry || feature.geometry.type !== 'Point') return;
      const [lng, lat] = feature.geometry.coordinates;
      const props = feature.properties ?? {};
      event.originalEvent.stopPropagation();
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ maxWidth: '300px', closeOnClick: true })
        .setLngLat([lng, lat])
        .setHTML(
          metroPlanStationPopupHtml({
            name: props.name as string | undefined,
            line: props.line as string | undefined,
            route: props.route as string | undefined,
            description: props.description as string | undefined,
          }),
        )
        .addTo(map);
    };

    const handleMetroPlanLineClick = (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const props = feature?.properties ?? {};
      event.originalEvent.stopPropagation();
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ maxWidth: '300px', closeOnClick: true })
        .setLngLat(event.lngLat)
        .setHTML(
          metroPlanLinePopupHtml({
            name: props.name as string | undefined,
            ref: props.ref as string | undefined,
            layer: props.layer as string | undefined,
          }),
        )
        .addTo(map);
    };

    const setPointer = (layerId: string, cursor: string) => {
      map.getCanvas().style.cursor = cursor;
    };

    map.on('load', () => {
      map.resize();
      const isSearch = Boolean(searchQueryRef.current.trim());
      syncTileSources(
        map,
        showParcelsRef.current && !isSearch,
        showHighwaysRef.current,
        showRailwaysRef.current,
        showQhsddRef.current && !isSearch,
        filtersRef.current,
        tileUrlCacheRef.current,
      );
      syncLayerVisibility(
        map,
        dataSourceRef.current,
        searchQueryRef.current,
        showParcelsRef.current,
        showHighwaysRef.current,
        showRailwaysRef.current,
        showQhsddRef.current,
      );
      onReadyRef.current();
      emitUpdate(map, (info) => onUpdateRef.current(info));
    });

    map.on('idle', () => {
      emitUpdate(map, (info) => onUpdateRef.current(info));
    });

    map.on('movestart', () => notifyMapInteractionStart());
    map.on('zoomstart', () => notifyMapInteractionStart());
    map.on('moveend', () => notifyMapInteractionEnd());
    map.on('zoomend', () => notifyMapInteractionEnd());

    map.on('error', (event) => {
      const message = event.error?.message;
      if (!message) return;
      // MapLibre throws this when vector source tiles are cleared with setTiles([]).
      if (/reading 'replace'/i.test(message)) return;
      // Aborted tiles during pan/zoom are expected with cancelPendingTileRequestsWhileZooming.
      if (/abort|aborted|AbortError/i.test(message)) return;
      // Transient tile holes after retries are noisy; user can pan to re-request.
      if (/Tile HTTP|Tile fetch failed/i.test(message)) return;
      onErrorRef.current(message);
    });

    map.on('moveend', () => {
      const center = map.getCenter();
      saveMapViewport({
        lng: center.lng,
        lat: center.lat,
        zoom: Math.round(map.getZoom() * 10) / 10,
      });
      emitUpdate(map, (info) => onUpdateRef.current(info));
    });

    map.on('click', 'parcel-fill', (event) => {
      void handleParcelClick(event);
    });

    map.on('click', 'search-parcel-fill', (event) => {
      void handleParcelClick(event);
    });

    map.on('click', 'property-buy-circles', handlePropertyBuyClick);
    map.on('click', 'railways-station', handleMetroStationClick);
    map.on('click', 'railways-metro-plan-station', handleMetroPlanStationClick);
    map.on('click', 'railways-l2-hit', handleMetroLine2Click);
    map.on('click', 'railways-metro-plan-hit', handleMetroPlanLineClick);

    map.on('mouseenter', 'parcel-fill', () => setPointer('parcel-fill', 'pointer'));
    map.on('mouseleave', 'parcel-fill', () => setPointer('parcel-fill', ''));
    map.on('mouseenter', 'search-parcel-fill', () => setPointer('search-parcel-fill', 'pointer'));
    map.on('mouseleave', 'search-parcel-fill', () => setPointer('search-parcel-fill', ''));
    map.on('mouseenter', 'property-buy-circles', () => setPointer('property-buy-circles', 'pointer'));
    map.on('mouseleave', 'property-buy-circles', () => setPointer('property-buy-circles', ''));
    map.on('mouseenter', 'railways-station', () => setPointer('railways-station', 'pointer'));
    map.on('mouseleave', 'railways-station', () => setPointer('railways-station', ''));
    map.on('mouseenter', 'railways-metro-plan-station', () =>
      setPointer('railways-metro-plan-station', 'pointer'),
    );
    map.on('mouseleave', 'railways-metro-plan-station', () =>
      setPointer('railways-metro-plan-station', ''),
    );
    map.on('mouseenter', 'railways-l2-hit', () => setPointer('railways-l2-hit', 'pointer'));
    map.on('mouseleave', 'railways-l2-hit', () => setPointer('railways-l2-hit', ''));
    map.on('mouseenter', 'railways-metro-plan-hit', () =>
      setPointer('railways-metro-plan-hit', 'pointer'),
    );
    map.on('mouseleave', 'railways-metro-plan-hit', () =>
      setPointer('railways-metro-plan-hit', ''),
    );

    map.on('click', (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: [
          'parcel-fill',
          'search-parcel-fill',
          'property-buy-circles',
          'railways-station',
          'railways-metro-plan-station',
          'railways-l2-hit',
          'railways-metro-plan-hit',
        ],
      });
      if (!features.length) {
        clearSelectedParcel(map);
      }
    });

    let resizeRaf = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        map.resize();
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeObserver.disconnect();
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const showLandLayers = dataSource === 'land_parcels';

    const apply = () => {
      onErrorRef.current('');
      const isSearch = Boolean(searchQuery.trim());
      syncLayerVisibility(map, dataSource, searchQuery, showParcels, showHighways, showRailways, showQhsdd);
      syncTileSources(
        map,
        showParcels && !isSearch,
        showHighways,
        showRailways,
        showQhsdd && !isSearch,
        filters,
        tileUrlCacheRef.current,
      );
      emitUpdate(map, (info) => onUpdateRef.current(info));
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once('load', apply);
    }

    if (!showLandLayers) {
      setGeoJsonSource(map, 'search-parcels', emptyFeatureCollection());
      clearSelectedParcel(map);
    }

    if (!showParcels) {
      popupRef.current?.remove();
      clearSelectedParcel(map);
    }
  }, [dataSource, searchQuery, showParcels, showHighways, showRailways, showQhsdd, filters.district, filters.ward]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || dataSource !== 'land_parcels' || !hasAdminFilter(filters)) return;

    const controller = new AbortController();
    fetchAdminBounds(
      { district: filters.district, ward: filters.ward },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted || !result.bounds || result.count === 0) return;
        const { minLat, maxLat, minLng, maxLng } = result.bounds;
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          { padding: 48, maxZoom: 16, duration: 500 },
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      });

    return () => controller.abort();
  }, [dataSource, filters.district, filters.ward]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    popupRef.current?.remove();
    clearSelectedParcel(map);
    onErrorRef.current('');
  }, [dataSource, searchQuery]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || dataSource !== 'land_parcels') return;

    const query = searchQuery.trim();
    if (!query || !isUsableStreetSearchQuery(query)) {
      setGeoJsonSource(map, 'search-parcels', emptyFeatureCollection());
      emitUpdate(map, (info) => onUpdateRef.current(info), { searchReturned: 0, truncated: false });
      return;
    }

    const controller = new AbortController();
    fetchParcels(
      {
        ...filters,
        source: 'land_parcels',
        q: query,
        includeGeometry: 'true',
      },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setGeoJsonSource(map, 'search-parcels', parcelsToGeoJson(result.items));
        const bounds = boundsFromParcels(result.items);
        if (bounds) {
          map.fitBounds(bounds, { padding: 48, maxZoom: 18, duration: 500 });
        }
        emitUpdate(map, (info) => onUpdateRef.current(info), {
          searchReturned: result.returned,
          truncated: result.truncated,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        onErrorRef.current(error instanceof Error ? error.message : 'Lỗi tìm kiếm');
      });

    return () => controller.abort();
  }, [filtersVersion, searchQuery, dataSource]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || dataSource !== 'property_buy_records') return;

    const controller = new AbortController();
    fetchPropertyBuyMapPoints(5000, {
      district: filters.district,
      ward: filters.ward,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setGeoJsonSource(map, 'property-buy-points', {
          type: 'FeatureCollection',
          features: result.items.map((item) => ({
            type: 'Feature',
            properties: {
              record_id: item.record_id,
              address: item.address,
              string: item.string,
            },
            geometry: {
              type: 'Point',
              coordinates: [item.long, item.lat],
            },
          })),
        });
        emitUpdate(map, (info) => onUpdateRef.current(info), {
          propertyBuyCount: result.items.length,
          visibleParcels: 0,
          visibleQhsdd: 0,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        onErrorRef.current(error instanceof Error ? error.message : 'Lỗi tải điểm giao dịch');
      });

    return () => controller.abort();
  }, [dataSource, filters.district, filters.ward, filtersVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusTarget) return;

    map.flyTo({
      center: [focusTarget.lng, focusTarget.lat],
      zoom: focusTarget.zoom ?? 16,
      duration: 500,
    });
  }, [focusTarget]);

  return <div ref={containerRef} className="map maplibre-map" />;
}
