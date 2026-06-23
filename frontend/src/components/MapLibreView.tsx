import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type Map, type MapLayerMouseEvent } from 'maplibre-gl';
import {
  fetchParcelById,
  fetchParcels,
  fetchPropertyBuyMapPoints,
  type ParcelQuery,
} from '../api';
import {
  HCM_CENTER,
  LAND_PARCELS_LAYER,
  LAND_PARCELS_MIN_ZOOM,
  QHSDD_LAYER,
  QHSDD_MAX_TILE_ZOOM,
  QHSDD_MIN_ZOOM,
  landParcelsTileUrl,
  qhsddTileUrl,
} from '../mapTiles';
import { QHSDD_LABEL_MIN_ZOOM } from '../mapViewport';
import type { Parcel, ParcelSource } from '../types';

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
  showQhsdd?: boolean;
  onUpdate: (info: MapLibreUpdate) => void;
  onError: (message: string) => void;
  onReady: () => void;
};

const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO';

function formatNumber(value: number | string | undefined) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function popupHtml(parcel: Parcel) {
  const location = [parcel.ward, parcel.district].filter(Boolean).join(', ');
  return `
    <div class="parcel-popup popup">
      <strong>${escapeHtml(parcel.address || parcel.property_code || 'Thửa đất')}</strong>
      <div>Mã: ${escapeHtml(parcel.property_code || '—')}</div>
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

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function parcelsToGeoJson(parcels: Parcel[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: parcels
      .filter((parcel) => parcel.geometry_json)
      .map((parcel) => ({
        type: 'Feature' as const,
        properties: { id: parcel.id },
        geometry: parcel.geometry_json!,
      })),
  };
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
  showQhsdd: boolean,
) {
  const isSearch = Boolean(searchQuery.trim());
  const showLandLayers = dataSource === 'land_parcels';
  const isPropertyBuy = dataSource === 'property_buy_records';

  setLayerVisibility(map, 'qhsdd-fill', showLandLayers && showQhsdd && !isSearch);
  setLayerVisibility(map, 'qhsdd-line', showLandLayers && showQhsdd && !isSearch);
  setLayerVisibility(map, 'qhsdd-label', showLandLayers && showQhsdd && !isSearch);
  setLayerVisibility(map, 'parcel-fill', showLandLayers && showParcels && !isSearch);
  setLayerVisibility(map, 'parcel-line', showLandLayers && showParcels && !isSearch);
  setLayerVisibility(map, 'search-parcel-fill', showLandLayers && showParcels && isSearch);
  setLayerVisibility(map, 'search-parcel-line', showLandLayers && showParcels && isSearch);
  setLayerVisibility(map, 'selected-parcel-fill', showLandLayers && showParcels);
  setLayerVisibility(map, 'selected-parcel-line', showLandLayers && showParcels);
  setLayerVisibility(map, 'property-buy-circles', isPropertyBuy);
}

function buildMapStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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
        tiles: [qhsddTileUrl()],
        minzoom: QHSDD_MIN_ZOOM,
        maxzoom: QHSDD_MAX_TILE_ZOOM,
      },
      parcels: {
        type: 'vector',
        tiles: [landParcelsTileUrl()],
        minzoom: LAND_PARCELS_MIN_ZOOM,
        maxzoom: 22,
      },
      'search-parcels': {
        type: 'geojson',
        data: emptyFeatureCollection(),
      },
      'selected-parcel': {
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
        filter: [
          'all',
          ['has', 'loai_dat_quy_hoach'],
          ['!=', ['get', 'loai_dat_quy_hoach'], ''],
        ],
        layout: {
          'text-field': ['get', 'loai_dat_quy_hoach'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 11,
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
        minzoom: LAND_PARCELS_MIN_ZOOM,
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
        minzoom: LAND_PARCELS_MIN_ZOOM,
        paint: {
          'line-color': '#14532d',
          'line-opacity': 0.82,
          'line-width': 1,
        },
      },
      {
        id: 'search-parcel-fill',
        type: 'fill',
        source: 'search-parcels',
        paint: {
          'fill-color': '#22c55e',
          'fill-opacity': 0.35,
        },
      },
      {
        id: 'search-parcel-line',
        type: 'line',
        source: 'search-parcels',
        paint: {
          'line-color': '#14532d',
          'line-width': 1.2,
        },
      },
      {
        id: 'selected-parcel-fill',
        type: 'fill',
        source: 'selected-parcel',
        paint: {
          'fill-color': '#fb7185',
          'fill-opacity': 0.25,
        },
      },
      {
        id: 'selected-parcel-line',
        type: 'line',
        source: 'selected-parcel',
        paint: {
          'line-color': '#e11d48',
          'line-width': 2,
        },
      },
      {
        id: 'property-buy-circles',
        type: 'circle',
        source: 'property-buy-points',
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
  showParcels = true,
  showQhsdd = true,
  onUpdate,
  onError,
  onReady,
}: MapLibreViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const dataSourceRef = useRef(dataSource);
  const filtersRef = useRef(filters);
  const searchQueryRef = useRef(searchQuery);
  const showParcelsRef = useRef(showParcels);
  const showQhsddRef = useRef(showQhsdd);

  onUpdateRef.current = onUpdate;
  onErrorRef.current = onError;
  onReadyRef.current = onReady;
  dataSourceRef.current = dataSource;
  filtersRef.current = filters;
  searchQueryRef.current = searchQuery;
  showParcelsRef.current = showParcels;
  showQhsddRef.current = showQhsdd;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(),
      center: HCM_CENTER,
      zoom: 17,
      attributionControl: { compact: true },
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
        setGeoJsonSource(map, 'selected-parcel', parcelToGeoJson(parcel));
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

    const setPointer = (layerId: string, cursor: string) => {
      map.getCanvas().style.cursor = cursor;
    };

    map.on('load', () => {
      map.resize();
      syncLayerVisibility(
        map,
        dataSourceRef.current,
        searchQueryRef.current,
        showParcelsRef.current,
        showQhsddRef.current,
      );
      onReadyRef.current();
      emitUpdate(map, (info) => onUpdateRef.current(info));
    });

    map.on('idle', () => {
      emitUpdate(map, (info) => onUpdateRef.current(info));
    });

    map.on('error', (event) => {
      const message = event.error?.message;
      if (message) {
        onErrorRef.current(message);
      }
    });

    map.on('moveend', () => {
      emitUpdate(map, (info) => onUpdateRef.current(info));
    });

    map.on('click', 'parcel-fill', (event) => {
      void handleParcelClick(event);
    });

    map.on('click', 'search-parcel-fill', (event) => {
      void handleParcelClick(event);
    });

    map.on('click', 'property-buy-circles', handlePropertyBuyClick);

    map.on('mouseenter', 'parcel-fill', () => setPointer('parcel-fill', 'pointer'));
    map.on('mouseleave', 'parcel-fill', () => setPointer('parcel-fill', ''));
    map.on('mouseenter', 'search-parcel-fill', () => setPointer('search-parcel-fill', 'pointer'));
    map.on('mouseleave', 'search-parcel-fill', () => setPointer('search-parcel-fill', ''));
    map.on('mouseenter', 'property-buy-circles', () => setPointer('property-buy-circles', 'pointer'));
    map.on('mouseleave', 'property-buy-circles', () => setPointer('property-buy-circles', ''));

    map.on('click', (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: ['parcel-fill', 'search-parcel-fill', 'property-buy-circles'],
      });
      if (!features.length) {
        setGeoJsonSource(map, 'selected-parcel', emptyFeatureCollection());
      }
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
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

    const apply = () => syncLayerVisibility(map, dataSource, searchQuery, showParcels, showQhsdd);

    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once('load', apply);
    }

    if (!showLandLayers) {
      setGeoJsonSource(map, 'search-parcels', emptyFeatureCollection());
      setGeoJsonSource(map, 'selected-parcel', emptyFeatureCollection());
    }

    if (!showParcels) {
      popupRef.current?.remove();
      setGeoJsonSource(map, 'selected-parcel', emptyFeatureCollection());
    }
  }, [dataSource, searchQuery, showParcels, showQhsdd]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    popupRef.current?.remove();
    setGeoJsonSource(map, 'selected-parcel', emptyFeatureCollection());
    onErrorRef.current('');
  }, [dataSource, searchQuery]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || dataSource !== 'land_parcels') return;

    const query = searchQuery.trim();
    if (!query) {
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
    fetchPropertyBuyMapPoints(5000)
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
  }, [dataSource, filtersVersion]);

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
