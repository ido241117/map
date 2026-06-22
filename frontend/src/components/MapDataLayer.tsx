import { useCallback, useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { fetchParcels, fetchPropertyBuyMapPoints, fetchQhsddZones, type ParcelQuery } from '../api';
import {
  shouldIncludeGeometry,
  shouldShowParcelMapOverlay,
  shouldShowQhsddLabels,
  shouldShowQhsddOverlay,
} from '../mapViewport';
import type { MapCluster, Parcel, ParcelListResponse, QhsddZone } from '../types';

const DEBOUNCE_MS = 300;
const MARKER_CHUNK = 600;
const GEOMETRY_CHUNK = 200;
const CLUSTER_CHUNK = 120;
const QHSDD_CHUNK = 250;

const QHSDD_PANE = 'qhsdd-overlay-pane';
const PARCEL_PANE = 'parcel-interactive-pane';

const POLYGON_STYLE: L.PathOptions = {
  color: '#14532d',
  fillColor: '#22c55e',
  fillOpacity: 0.28,
  opacity: 0.82,
  weight: 1,
};

const OSM_POLYGON_STYLE: L.PathOptions = {
  color: '#1e3a8a',
  fillColor: '#3b82f6',
  fillOpacity: 0.35,
  opacity: 0.9,
  weight: 1,
};

const OSM_LINE_STYLE: L.PathOptions = {
  color: '#dc2626',
  fillOpacity: 0,
  opacity: 0.85,
  weight: 2,
};

const MARKER_STYLE: L.CircleMarkerOptions = {
  radius: 4,
  fillColor: '#22c55e',
  color: '#14532d',
  weight: 1,
  opacity: 0.85,
  fillOpacity: 0.65,
};

const OSM_MARKER_STYLE: L.CircleMarkerOptions = {
  radius: 4,
  fillColor: '#3b82f6',
  color: '#1e3a8a',
  weight: 1,
  opacity: 0.85,
  fillOpacity: 0.65,
};

const PROPERTY_BUY_MARKER_STYLE: L.CircleMarkerOptions = {
  radius: 5,
  fillColor: '#f97316',
  color: '#9a3412',
  weight: 1,
  opacity: 0.95,
  fillOpacity: 0.8,
};

function clusterRadius(count: number) {
  return Math.min(28, 10 + Math.log10(Math.max(count, 1)) * 5);
}

function clusterPopupHtml(cluster: MapCluster) {
  return `
    <div class="popup">
      <strong>${formatNumber(cluster.cluster_count)} thửa</strong>
      <span>Zoom in (≥16) để xem ranh thửa</span>
    </div>
  `;
}

function formatNumber(value: number | string | undefined) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

function qhsddStyle(zone: QhsddZone): L.PathOptions {
  const fill = zone.fill_hex || '#94a3b8';
  return {
    color: fill,
    fillColor: fill,
    fillOpacity: 0.42,
    opacity: 0.78,
    weight: 0.8,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function qhsddLabelHtml(zone: QhsddZone) {
  const name = escapeHtml(zone.loai_dat_quy_hoach || 'Vùng quy hoạch');
  return `<div class="qhsdd-zone-label"><span class="qhsdd-zone-name">${name}</span></div>`;
}

function bindParcelInteraction(layer: L.Layer, parcel: Parcel, isOsm: boolean) {
  layer.bindPopup(popupHtml(parcel, isOsm), POPUP_OPTIONS);
}

const POPUP_OPTIONS: L.PopupOptions = {
  maxWidth: 320,
  autoPan: false,
};

function popupHtml(parcel: Parcel, isOsm = false) {
  if (isOsm) {
    return `
      <div class="popup">
        <strong>${parcel.address || parcel.property_code || 'OSM feature'}</strong>
        <span>Loại: ${parcel.planning_land_type || '—'}</span>
        <span>OSM ID: ${parcel.property_code || '—'}</span>
        ${parcel.total_area ? `<span>Diện tích ~${formatNumber(parcel.total_area)} m²</span>` : ''}
      </div>
    `;
  }

  return `
    <div class="popup">
      <strong>${parcel.address || parcel.property_code || 'Thửa đất'}</strong>
      <span>Mã: ${parcel.property_code || '—'}</span>
      <span>Diện tích: ${formatNumber(parcel.total_area)} m²</span>
      <span>Loại đất: ${parcel.planning_land_type || '—'}</span>
      <span>${parcel.ward || ''}${parcel.ward && parcel.district ? ', ' : ''}${parcel.district || ''}</span>
    </div>
  `;
}

function isMapPopupOpen(map: L.Map) {
  const popup = (map as L.Map & { _popup?: L.Popup })._popup;
  return Boolean(popup?.isOpen());
}

type MapDataLayerProps = {
  filters: Omit<ParcelQuery, 'minLat' | 'maxLat' | 'minLng' | 'maxLng' | 'includeGeometry'>;
  filtersVersion: string;
  onUpdate: (result: ParcelListResponse, zoom: number) => void;
  onError: (message: string) => void;
  focusTarget?: { lat: number; lng: number; zoom?: number; key: string } | null;
};

export function MapDataLayer({
  filters,
  filtersVersion,
  onUpdate,
  onError,
  focusTarget = null,
}: MapDataLayerProps) {
  const map = useMap();
  const PROPERTY_BUY_PANE = 'property-buy-points-pane';
  const layerRef = useRef<L.LayerGroup | null>(null);
  const qhsddLayerRef = useRef<L.LayerGroup | null>(null);
  const qhsddLabelsLayerRef = useRef<L.LayerGroup | null>(null);
  const lastQhsddZonesRef = useRef<QhsddZone[]>([]);
  const qhsddLabelsVisibleRef = useRef(false);
  const propertyBuyLayerRef = useRef<L.LayerGroup | null>(null);
  const pointRendererRef = useRef(L.canvas({ padding: 0.25, pane: PARCEL_PANE }));
  const polygonRendererRef = useRef(L.canvas({ padding: 0.35, pane: PARCEL_PANE }));
  const qhsddRendererRef = useRef(L.canvas({ padding: 0.35, pane: QHSDD_PANE }));
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const renderGenRef = useRef(0);
  const qhsddPolygonGenRef = useRef(0);
  const qhsddLabelGenRef = useRef(0);
  const lastFetchKeyRef = useRef('');
  const lastRenderedKeyRef = useRef('');
  const suppressEventsRef = useRef(false);
  const pendingAfterPopupRef = useRef(false);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const renderQhsddLabels = useCallback((zones: QhsddZone[]) => {
    if (!qhsddLabelsLayerRef.current) {
      qhsddLabelsLayerRef.current = L.layerGroup().addTo(map);
    }

    const group = qhsddLabelsLayerRef.current;
    const gen = ++qhsddLabelGenRef.current;
    group.clearLayers();
    qhsddLabelsVisibleRef.current = false;
    if (!zones.length) return;

    let index = 0;

    const step = () => {
      if (gen !== qhsddLabelGenRef.current) return;

      const end = Math.min(index + QHSDD_CHUNK, zones.length);
      for (; index < end; index += 1) {
        const zone = zones[index];
        if (!Number.isFinite(zone.center_lat) || !Number.isFinite(zone.center_long)) continue;
        L.marker([zone.center_lat, zone.center_long], {
          pane: QHSDD_PANE,
          interactive: false,
          icon: L.divIcon({
            className: 'qhsdd-zone-label-wrap',
            html: qhsddLabelHtml(zone),
            iconSize: [1, 1],
            iconAnchor: [0, 0],
          }),
        }).addTo(group);
      }

      if (index < zones.length) {
        requestAnimationFrame(step);
      } else {
        qhsddLabelsVisibleRef.current = true;
      }
    };

    requestAnimationFrame(step);
  }, [map]);

  const syncQhsddLabels = useCallback((zoom: number) => {
    const shouldShow = shouldShowQhsddLabels(zoom);
    if (shouldShow === qhsddLabelsVisibleRef.current) return;

    if (shouldShow) {
      renderQhsddLabels(lastQhsddZonesRef.current);
    } else if (qhsddLabelsLayerRef.current) {
      qhsddLabelsLayerRef.current.clearLayers();
      qhsddLabelsVisibleRef.current = false;
    }
  }, [renderQhsddLabels]);

  const renderQhsddZones = useCallback((zones: QhsddZone[], zoom: number) => {
    if (!qhsddLayerRef.current) {
      qhsddLayerRef.current = L.layerGroup().addTo(map);
    }

    const group = qhsddLayerRef.current;
    const gen = ++qhsddPolygonGenRef.current;
    qhsddLabelGenRef.current += 1;
    group.clearLayers();
    if (qhsddLabelsLayerRef.current) {
      qhsddLabelsLayerRef.current.clearLayers();
    }
    qhsddLabelsVisibleRef.current = false;
    lastQhsddZonesRef.current = zones;
    if (!zones.length) return;

    const renderer = qhsddRendererRef.current;
    let index = 0;

    const step = () => {
      if (gen !== qhsddPolygonGenRef.current) return;

      const end = Math.min(index + QHSDD_CHUNK, zones.length);
      const chunk = zones.slice(index, end);
      index = end;

      const collection: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: chunk.map((zone) => ({
          type: 'Feature' as const,
          properties: zone,
          geometry: zone.geometry_json,
        })),
      };

      L.geoJSON(collection, {
        pane: QHSDD_PANE,
        interactive: false,
        style: (feature) => ({
          ...qhsddStyle(feature?.properties as QhsddZone),
          renderer,
        }),
      }).addTo(group);

      if (index < zones.length) {
        requestAnimationFrame(step);
      } else if (shouldShowQhsddLabels(zoom)) {
        renderQhsddLabels(zones);
      }
    };

    requestAnimationFrame(step);
  }, [map, renderQhsddLabels]);

  const renderParcels = useCallback((parcels: Parcel[], showGeometry: boolean) => {
    if (!layerRef.current) {
      layerRef.current = L.layerGroup().addTo(map);
    }

    const isOsm = filtersRef.current.source === 'osm_hcm';
    const group = layerRef.current;
    const gen = ++renderGenRef.current;
    group.clearLayers();

    if (showGeometry) {
      const withGeometry = parcels.filter((p) => p.geometry_json);
      if (!withGeometry.length) return;

      let index = 0;
      const renderer = polygonRendererRef.current;

      const step = () => {
        if (gen !== renderGenRef.current) return;

        const end = Math.min(index + GEOMETRY_CHUNK, withGeometry.length);
        const chunk = withGeometry.slice(index, end);
        index = end;

        const collection: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: chunk.map((p) => ({
            type: 'Feature' as const,
            properties: p,
            geometry: p.geometry_json!,
          })),
        };

        L.geoJSON(collection, {
          pane: PARCEL_PANE,
          style: (feature) => {
            const type = feature?.geometry?.type;
            if (type === 'LineString' || type === 'MultiLineString') {
              return { ...OSM_LINE_STYLE, renderer };
            }
            return { ...(isOsm ? OSM_POLYGON_STYLE : POLYGON_STYLE), renderer };
          },
          onEachFeature: (feature, layer) => {
            bindParcelInteraction(layer, feature.properties as Parcel, isOsm);
          },
        }).addTo(group);

        if (index < withGeometry.length) {
          requestAnimationFrame(step);
        }
      };

      requestAnimationFrame(step);
      return;
    }

    const renderer = pointRendererRef.current;
    let index = 0;

    const step = () => {
      if (gen !== renderGenRef.current) return;

      const end = Math.min(index + MARKER_CHUNK, parcels.length);
      for (; index < end; index += 1) {
        const parcel = parcels[index];
        const marker = L.circleMarker([parcel.latitude, parcel.longitude], {
          ...(isOsm ? OSM_MARKER_STYLE : MARKER_STYLE),
          pane: PARCEL_PANE,
          renderer,
        });
        bindParcelInteraction(marker, parcel, isOsm);
        marker.addTo(group);
      }

      if (index < parcels.length) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  }, [map]);

  const renderClusters = useCallback((clusters: MapCluster[]) => {
    if (!layerRef.current) {
      layerRef.current = L.layerGroup().addTo(map);
    }

    const group = layerRef.current;
    const gen = ++renderGenRef.current;
    group.clearLayers();
    if (!clusters.length) return;

    const renderer = pointRendererRef.current;
    let index = 0;

    const step = () => {
      if (gen !== renderGenRef.current) return;

      const end = Math.min(index + CLUSTER_CHUNK, clusters.length);
      for (; index < end; index += 1) {
        const cluster = clusters[index];
        const radius = clusterRadius(cluster.cluster_count);
        L.circleMarker([cluster.latitude, cluster.longitude], {
          radius,
          fillColor: '#16a34a',
          color: '#14532d',
          weight: 1.5,
          opacity: 0.9,
          fillOpacity: 0.55,
          pane: PARCEL_PANE,
          renderer,
        })
          .bindPopup(clusterPopupHtml(cluster), POPUP_OPTIONS)
          .addTo(group);

        if (cluster.cluster_count >= 20) {
          L.marker([cluster.latitude, cluster.longitude], {
            icon: L.divIcon({
              className: 'parcel-cluster-label',
              html: `<span>${formatNumber(cluster.cluster_count)}</span>`,
              iconSize: [40, 20],
              iconAnchor: [20, 10],
            }),
            interactive: false,
          }).addTo(group);
        }
      }

      if (index < clusters.length) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  }, [map]);

  useEffect(() => {
    if (!map.getPane(QHSDD_PANE)) {
      const pane = map.createPane(QHSDD_PANE);
      pane.style.zIndex = '350';
      pane.style.pointerEvents = 'none';
    }
    if (!map.getPane(PARCEL_PANE)) {
      const pane = map.createPane(PARCEL_PANE);
      pane.style.zIndex = '450';
    }
    if (!map.getPane(PROPERTY_BUY_PANE)) {
      const pane = map.createPane(PROPERTY_BUY_PANE);
      pane.style.zIndex = '660';
      pane.style.pointerEvents = 'none';
    }
  }, [map, PROPERTY_BUY_PANE]);

  useEffect(() => {
    const pane = map.getPane(PROPERTY_BUY_PANE);
    if (!pane) return;
    pane.style.pointerEvents =
      filtersRef.current.source === 'property_buy_records' ? 'auto' : 'none';
  }, [map, filters.source, PROPERTY_BUY_PANE]);

  const runFetch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const current = filtersRef.current;
    const isAddressSearch = Boolean(current.q?.trim());
    const showGeometry = shouldIncludeGeometry(zoom, isAddressSearch);
    const showQhsdd = shouldShowQhsddOverlay(current.source, zoom, isAddressSearch);
    const showParcels = shouldShowParcelMapOverlay(current.source, zoom, isAddressSearch);
    if (current.source === 'property_buy_records') {
      renderGenRef.current += 1;
      if (layerRef.current) {
        layerRef.current.clearLayers();
      }
      const result = await fetchPropertyBuyMapPoints(100);
      if (controller.signal.aborted) return;
      if (!propertyBuyLayerRef.current) {
        propertyBuyLayerRef.current = L.layerGroup().addTo(map);
      }
      const group = propertyBuyLayerRef.current;
      group.clearLayers();
      result.items.forEach((item) => {
        L.circleMarker([item.lat, item.long], {
          ...PROPERTY_BUY_MARKER_STYLE,
          pane: PROPERTY_BUY_PANE,
        })
          .bindPopup(
            `
              <div class="popup">
                <strong>${item.string || item.address || `Record #${item.record_id}`}</strong>
                <span>Record: ${item.record_id}</span>
                <span>Tọa độ: ${item.lat.toFixed(6)}, ${item.long.toFixed(6)}</span>
              </div>
            `,
            POPUP_OPTIONS,
          )
          .addTo(group);
      });
      onUpdateRef.current(
        { source: current.source, mode: 'parcels', items: [], clusters: [], truncated: false, returned: result.items.length },
        zoom,
      );
      return;
    }
    if (current.source === 'hcm_qhsdd') {
      renderGenRef.current += 1;
      layerRef.current?.clearLayers();

      const qhsddKey = JSON.stringify({
        source: 'hcm_qhsdd',
        minLat: bounds.getSouth().toFixed(4),
        maxLat: bounds.getNorth().toFixed(4),
        minLng: bounds.getWest().toFixed(4),
        maxLng: bounds.getEast().toFixed(4),
        zoom,
      });
      if (qhsddKey === lastFetchKeyRef.current) return;

      const requestId = ++requestIdRef.current;
      onErrorRef.current('');

      try {
        if (!showQhsdd) {
          qhsddLayerRef.current?.clearLayers();
          lastQhsddZonesRef.current = [];
          qhsddLabelsLayerRef.current?.clearLayers();
          qhsddLabelsVisibleRef.current = false;
          lastFetchKeyRef.current = qhsddKey;
          onUpdateRef.current(
            {
              source: 'hcm_qhsdd',
              mode: 'parcels',
              items: [],
              clusters: [],
              truncated: false,
              returned: 0,
            },
            zoom,
          );
          return;
        }

        const qhsddResult = await fetchQhsddZones(
          {
            minLat: bounds.getSouth().toFixed(4),
            maxLat: bounds.getNorth().toFixed(4),
            minLng: bounds.getWest().toFixed(4),
            maxLng: bounds.getEast().toFixed(4),
            zoom: String(zoom),
          },
          controller.signal,
        );
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;

        lastFetchKeyRef.current = qhsddKey;
        onUpdateRef.current(
          {
            source: 'hcm_qhsdd',
            mode: 'parcels',
            items: [],
            clusters: [],
            truncated: qhsddResult.truncated,
            returned: qhsddResult.returned,
          },
          zoom,
        );
        renderQhsddZones(qhsddResult.items, zoom);
      } catch (err) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        onErrorRef.current(err instanceof Error ? err.message : 'Lỗi tải dữ liệu');
      }
      return;
    }
    if (propertyBuyLayerRef.current) {
      propertyBuyLayerRef.current.clearLayers();
    }
    if (!showQhsdd && qhsddLayerRef.current) {
      qhsddLayerRef.current.clearLayers();
    }
    if (!showQhsdd) {
      lastQhsddZonesRef.current = [];
      if (qhsddLabelsLayerRef.current) {
        qhsddLabelsLayerRef.current.clearLayers();
      }
      qhsddLabelsVisibleRef.current = false;
    }

    const query: ParcelQuery = {
      ...current,
      ...(isAddressSearch
        ? {}
        : {
            minLat: bounds.getSouth().toFixed(4),
            maxLat: bounds.getNorth().toFixed(4),
            minLng: bounds.getWest().toFixed(4),
            maxLng: bounds.getEast().toFixed(4),
          }),
      zoom: isAddressSearch ? undefined : String(zoom),
      includeGeometry: showGeometry ? 'true' : 'false',
    };

    const fetchKey = JSON.stringify(query);
    if (fetchKey === lastFetchKeyRef.current) return;

    const requestId = ++requestIdRef.current;
    onErrorRef.current('');

    try {
      const [result, qhsddResult] = await Promise.all([
        fetchParcels(query, controller.signal),
        showQhsdd
          ? fetchQhsddZones(
              {
                minLat: bounds.getSouth().toFixed(4),
                maxLat: bounds.getNorth().toFixed(4),
                minLng: bounds.getWest().toFixed(4),
                maxLng: bounds.getEast().toFixed(4),
                zoom: String(zoom),
              },
              controller.signal,
            )
          : Promise.resolve({ items: [], returned: 0, truncated: false }),
      ]);
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;

      lastFetchKeyRef.current = fetchKey;
      onUpdateRef.current(result, zoom);

      if (showQhsdd) {
        renderQhsddZones(qhsddResult.items, zoom);
      }

      if (fetchKey !== lastRenderedKeyRef.current) {
        lastRenderedKeyRef.current = fetchKey;
        if (!showParcels) {
          renderGenRef.current += 1;
          layerRef.current?.clearLayers();
        } else if (result.mode === 'clusters') {
          renderClusters(result.clusters);
        } else {
          renderParcels(result.items, showGeometry);
        }
      }
    } catch (err) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      onErrorRef.current(err instanceof Error ? err.message : 'Lỗi tải dữ liệu');
    }
  }, [map, renderParcels, renderClusters, renderQhsddZones, PROPERTY_BUY_PANE]);

  const runFetchRef = useRef(runFetch);
  runFetchRef.current = runFetch;

  const scheduleFetch = useCallback(() => {
    if (suppressEventsRef.current) return;

    if (isMapPopupOpen(map)) {
      if (!pendingAfterPopupRef.current) {
        pendingAfterPopupRef.current = true;
        map.once('popupclose', () => {
          pendingAfterPopupRef.current = false;
          scheduleFetchRef.current();
        });
      }
      return;
    }

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runFetchRef.current();
    }, DEBOUNCE_MS);
  }, [map]);

  const scheduleFetchRef = useRef(scheduleFetch);
  scheduleFetchRef.current = scheduleFetch;

  useMapEvents({
    moveend: () => {
      if (filtersRef.current.source === 'property_buy_records') return;
      scheduleFetchRef.current();
    },
    zoomend: () => {
      if (filtersRef.current.source === 'property_buy_records') return;
      syncQhsddLabels(map.getZoom());
    },
  });

  useEffect(() => {
    // Hard reset visual layers when switching source to avoid stale interactive overlays.
    renderGenRef.current += 1;
    qhsddPolygonGenRef.current += 1;
    qhsddLabelGenRef.current += 1;
    abortRef.current?.abort();
    if (layerRef.current) {
      layerRef.current.clearLayers();
    }
    if (qhsddLayerRef.current) {
      qhsddLayerRef.current.clearLayers();
    }
    if (qhsddLabelsLayerRef.current) {
      qhsddLabelsLayerRef.current.clearLayers();
    }
    lastQhsddZonesRef.current = [];
    qhsddLabelsVisibleRef.current = false;
    if (propertyBuyLayerRef.current) {
      propertyBuyLayerRef.current.clearLayers();
    }
  }, [filters.source]);

  useEffect(() => {
    lastFetchKeyRef.current = '';
    lastRenderedKeyRef.current = '';
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runFetchRef.current();
    }, DEBOUNCE_MS);
  }, [filtersVersion]);

  useEffect(() => {
    if (!focusTarget) return;

    suppressEventsRef.current = true;
    map.flyTo([focusTarget.lat, focusTarget.lng], focusTarget.zoom ?? 16, { duration: 0.4 });
    map.once('moveend', () => {
      suppressEventsRef.current = false;
    });
  }, [focusTarget, map]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      renderGenRef.current += 1;
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }
      if (qhsddLayerRef.current) {
        qhsddLayerRef.current.remove();
        qhsddLayerRef.current = null;
      }
      if (qhsddLabelsLayerRef.current) {
        qhsddLabelsLayerRef.current.remove();
        qhsddLabelsLayerRef.current = null;
      }
      if (propertyBuyLayerRef.current) {
        propertyBuyLayerRef.current.remove();
        propertyBuyLayerRef.current = null;
      }
    };
  }, []);

  return null;
}
