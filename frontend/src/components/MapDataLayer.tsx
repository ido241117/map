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
import {
  boundsContains,
  boundsToQuery,
  expandBounds,
  filterParcelsInBounds,
  getViewportZoomBucket,
  MAP_MOVE_DEBOUNCE_MS,
  mergeParcelsIntoStore,
  pruneParcelStore,
  resolveParcelLimit,
  VIEWPORT_FETCH_PAD,
} from '../mapViewportCache';
import type { MapCluster, Parcel, ParcelListResponse, QhsddZone } from '../types';

const MARKER_CHUNK = 600;
const GEOMETRY_CHUNK = 400;
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

const MARKER_STYLE: L.CircleMarkerOptions = {
  radius: 4,
  fillColor: '#22c55e',
  color: '#14532d',
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

function buildFilterKey(filters: Omit<ParcelQuery, 'minLat' | 'maxLat' | 'minLng' | 'maxLng' | 'includeGeometry'>) {
  return JSON.stringify({
    source: filters.source,
    q: filters.q,
    district: filters.district,
    ward: filters.ward,
    landType: filters.landType,
    minArea: filters.minArea,
    maxArea: filters.maxArea,
  });
}

function bindParcelInteraction(map: L.Map, layer: L.Layer, parcel: Parcel) {
  layer.on('click', (event: L.LeafletMouseEvent) => {
    L.popup(POPUP_OPTIONS)
      .setLatLng(event.latlng)
      .setContent(popupHtml(parcel))
      .openOn(map);
  });
}

const POPUP_OPTIONS: L.PopupOptions = {
  maxWidth: 320,
  autoPan: false,
};

function popupHtml(parcel: Parcel) {
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
  const loadedParcelsRef = useRef<Map<number, Parcel>>(new Map());
  const parcelCacheRef = useRef<{
    fetchBounds: L.LatLngBounds;
    zoom: number;
    filterKey: string;
    showGeometry: boolean;
    fetchKey: string;
    result: ParcelListResponse;
  } | null>(null);
  const qhsddCacheRef = useRef<{
    fetchBounds: L.LatLngBounds;
    zoom: number;
    fetchKey: string;
    zones: QhsddZone[];
  } | null>(null);
  const skipViewportCacheRef = useRef(false);
  const suppressEventsRef = useRef(false);
  const pendingAfterPopupRef = useRef(false);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const renderQhsddLabels = useCallback((zones: QhsddZone[]) => {
    if (!qhsddLabelsLayerRef.current) return;

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
    if (!qhsddLayerRef.current) return;

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

    const group = layerRef.current;
    const gen = ++renderGenRef.current;
    const staging = L.layerGroup();

    const commitStaging = () => {
      if (gen !== renderGenRef.current) return;
      group.clearLayers();
      staging.eachLayer((layer) => layer.addTo(group));
    };

    if (showGeometry) {
      const withGeometry = parcels.filter((p) => p.geometry_json);
      if (!withGeometry.length) {
        group.clearLayers();
        return;
      }

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
          style: () => ({ ...POLYGON_STYLE, renderer }),
          onEachFeature: (feature, layer) => {
            bindParcelInteraction(map, layer, feature.properties as Parcel);
          },
        }).addTo(staging);

        if (index < withGeometry.length) {
          requestAnimationFrame(step);
        } else {
          commitStaging();
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
          ...MARKER_STYLE,
          pane: PARCEL_PANE,
          renderer,
        });
        bindParcelInteraction(map, marker, parcel);
        marker.addTo(staging);
      }

      if (index < parcels.length) {
        requestAnimationFrame(step);
      } else {
        commitStaging();
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
    const staging = L.layerGroup();
    if (!clusters.length) {
      group.clearLayers();
      return;
    }

    const commitStaging = () => {
      if (gen !== renderGenRef.current) return;
      group.clearLayers();
      staging.eachLayer((layer) => layer.addTo(group));
    };

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
          .addTo(staging);

        if (cluster.cluster_count >= 20) {
          L.marker([cluster.latitude, cluster.longitude], {
            pane: PARCEL_PANE,
            icon: L.divIcon({
              className: 'parcel-cluster-label',
              html: `<span>${formatNumber(cluster.cluster_count)}</span>`,
              iconSize: [40, 20],
              iconAnchor: [20, 10],
            }),
            interactive: false,
          }).addTo(staging);
        }
      }

      if (index < clusters.length) {
        requestAnimationFrame(step);
      } else {
        commitStaging();
      }
    };

    requestAnimationFrame(step);
  }, [map]);

  const renderVisibleParcels = useCallback((viewBounds: L.LatLngBounds, showGeometry: boolean) => {
    const visible = filterParcelsInBounds(
      loadedParcelsRef.current.values(),
      expandBounds(viewBounds, 0.15),
    );
    renderParcels(visible, showGeometry);
    return visible;
  }, [renderParcels]);

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

    // QHSDD layer groups sit below parcel layers so thửa đất stays clickable.
    if (!qhsddLayerRef.current) {
      qhsddLayerRef.current = L.layerGroup().addTo(map);
    }
    if (!qhsddLabelsLayerRef.current) {
      qhsddLabelsLayerRef.current = L.layerGroup().addTo(map);
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
    const filterKey = buildFilterKey(current);
    const zoomBucket = getViewportZoomBucket(zoom, isAddressSearch);
    const viewBounds = bounds;
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
      qhsddCacheRef.current = null;
    }

    const parcelCache = parcelCacheRef.current;
    const useViewportCache = !skipViewportCacheRef.current && !isAddressSearch;
    skipViewportCacheRef.current = false;

    const parcelCacheHit =
      useViewportCache &&
      showParcels &&
      parcelCache !== null &&
      parcelCache.zoom === zoom &&
      parcelCache.filterKey === filterKey &&
      parcelCache.showGeometry === showGeometry &&
      boundsContains(parcelCache.fetchBounds, viewBounds);

    const qhsddCache = qhsddCacheRef.current;
    const qhsddCacheHit =
      useViewportCache &&
      showQhsdd &&
      qhsddCache !== null &&
      qhsddCache.zoom === zoom &&
      boundsContains(qhsddCache.fetchBounds, viewBounds);

    if (parcelCacheHit && parcelCache) {
      const visible = renderVisibleParcels(viewBounds, showGeometry);
      onUpdateRef.current({ ...parcelCache.result, returned: visible.length }, zoom);
    }

    if (qhsddCacheHit && qhsddCache) {
      lastQhsddZonesRef.current = qhsddCache.zones;
      if (shouldShowQhsddLabels(zoom) && !qhsddLabelsVisibleRef.current) {
        renderQhsddLabels(qhsddCache.zones);
      }
    }

    if (parcelCacheHit && (!showQhsdd || qhsddCacheHit)) {
      return;
    }

    const fetchBounds = expandBounds(viewBounds, VIEWPORT_FETCH_PAD);
    const bboxQuery = boundsToQuery(fetchBounds, zoom);
    const parcelMode = zoomBucket === 'clusters' ? 'clusters' : 'parcels';
    const parcelLimit = resolveParcelLimit(showGeometry, parcelMode);

    const query: ParcelQuery = {
      ...current,
      ...(isAddressSearch ? {} : bboxQuery),
      zoom: isAddressSearch ? undefined : String(zoom),
      includeGeometry: showGeometry ? 'true' : 'false',
      limit: isAddressSearch ? undefined : String(parcelLimit),
    };

    const parcelFetchKey = JSON.stringify({
      kind: 'parcels',
      query,
      zoomBucket,
    });
    const qhsddFetchKey = JSON.stringify({
      kind: 'qhsdd',
      ...bboxQuery,
      zoom,
    });
    const combinedFetchKey = `${parcelFetchKey}|${showQhsdd ? qhsddFetchKey : 'off'}`;

    const requestId = ++requestIdRef.current;
    onErrorRef.current('');

    try {
      const parcelPromise =
        parcelCacheHit || !showParcels
          ? Promise.resolve(parcelCache?.result ?? null)
          : fetchParcels(query, controller.signal);

      const qhsddPromise =
        !showQhsdd || qhsddCacheHit
          ? Promise.resolve(null)
          : fetchQhsddZones(
              {
                ...bboxQuery,
                zoom: String(zoom),
              },
              controller.signal,
            );

      const [result, qhsddResult] = await Promise.all([parcelPromise, qhsddPromise]);
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;

      lastFetchKeyRef.current = combinedFetchKey;

      if (result && !parcelCacheHit) {
        if (!isAddressSearch && result.mode === 'parcels') {
          mergeParcelsIntoStore(loadedParcelsRef.current, result.items);
          pruneParcelStore(loadedParcelsRef.current, viewBounds);
          parcelCacheRef.current = {
            fetchBounds,
            zoom,
            filterKey,
            showGeometry,
            fetchKey: parcelFetchKey,
            result,
          };
          const visible = renderVisibleParcels(viewBounds, showGeometry);
          onUpdateRef.current({ ...result, returned: visible.length }, zoom);
        } else {
          loadedParcelsRef.current.clear();
          if (isAddressSearch) {
            mergeParcelsIntoStore(loadedParcelsRef.current, result.items);
          }
          onUpdateRef.current(result, zoom);
          if (result.mode === 'clusters') {
            renderClusters(result.clusters);
          } else {
            renderParcels(result.items, showGeometry);
          }
        }
      }

      if (qhsddResult && showQhsdd) {
        qhsddCacheRef.current = {
          fetchBounds,
          zoom,
          fetchKey: qhsddFetchKey,
          zones: qhsddResult.items,
        };
        renderQhsddZones(qhsddResult.items, zoom);
      }
    } catch (err) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      onErrorRef.current(err instanceof Error ? err.message : 'Lỗi tải dữ liệu');
    }
  }, [map, renderParcels, renderClusters, renderVisibleParcels, renderQhsddZones, renderQhsddLabels, PROPERTY_BUY_PANE]);

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
    }, MAP_MOVE_DEBOUNCE_MS);
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
      skipViewportCacheRef.current = true;
      parcelCacheRef.current = null;
      qhsddCacheRef.current = null;
      loadedParcelsRef.current.clear();
      lastFetchKeyRef.current = '';
      syncQhsddLabels(map.getZoom());
      scheduleFetchRef.current();
    },
  });

  useEffect(() => {
    // Hard reset visual layers when switching source to avoid stale interactive overlays.
    renderGenRef.current += 1;
    qhsddPolygonGenRef.current += 1;
    qhsddLabelGenRef.current += 1;
    abortRef.current?.abort();
    parcelCacheRef.current = null;
    qhsddCacheRef.current = null;
    loadedParcelsRef.current.clear();
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
    parcelCacheRef.current = null;
    qhsddCacheRef.current = null;
    loadedParcelsRef.current.clear();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runFetchRef.current();
    }, MAP_MOVE_DEBOUNCE_MS);
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
