import { useCallback, useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { fetchParcels, type ParcelQuery } from '../api';
import type { Parcel, ParcelListResponse } from '../types';

const GEOMETRY_ZOOM = 14;
const DEBOUNCE_MS = 300;
const PARCEL_LIMIT = 5000;
const MARKER_CHUNK = 600;
const GEOMETRY_CHUNK = 200;

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

function formatNumber(value: number | string | undefined) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

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

type MapDataLayerProps = {
  filters: Omit<ParcelQuery, 'minLat' | 'maxLat' | 'minLng' | 'maxLng' | 'includeGeometry'>;
  filtersVersion: string;
  onUpdate: (result: ParcelListResponse, zoom: number) => void;
  onLoading: (loading: boolean) => void;
  onError: (message: string) => void;
  fitToResults?: boolean;
};

export function MapDataLayer({
  filters,
  filtersVersion,
  onUpdate,
  onLoading,
  onError,
  fitToResults = false,
}: MapDataLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);
  const pointRendererRef = useRef(L.canvas({ padding: 0.25 }));
  const polygonRendererRef = useRef(L.canvas({ padding: 0.35 }));
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const renderGenRef = useRef(0);
  const lastFetchKeyRef = useRef('');
  const suppressEventsRef = useRef(false);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onLoadingRef = useRef(onLoading);
  onLoadingRef.current = onLoading;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const fitToResultsRef = useRef(fitToResults);
  fitToResultsRef.current = fitToResults;

  const renderParcels = useCallback((parcels: Parcel[], showGeometry: boolean) => {
    if (!layerRef.current) {
      layerRef.current = L.layerGroup().addTo(map);
    }

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
          style: () => ({ ...POLYGON_STYLE, renderer }),
          onEachFeature: (feature, layer) => {
            layer.bindPopup(popupHtml(feature.properties as Parcel), { maxWidth: 320 });
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
        L.circleMarker([parcel.latitude, parcel.longitude], { ...MARKER_STYLE, renderer })
          .bindPopup(popupHtml(parcel), { maxWidth: 320 })
          .addTo(group);
      }

      if (index < parcels.length) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  }, [map]);

  const runFetch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const showGeometry = zoom >= GEOMETRY_ZOOM;
    const current = filtersRef.current;

    const query: ParcelQuery = {
      ...current,
      minLat: bounds.getSouth().toFixed(6),
      maxLat: bounds.getNorth().toFixed(6),
      minLng: bounds.getWest().toFixed(6),
      maxLng: bounds.getEast().toFixed(6),
      includeGeometry: showGeometry ? 'true' : 'false',
      limit: String(PARCEL_LIMIT),
    };

    const fetchKey = JSON.stringify(query);
    if (fetchKey === lastFetchKeyRef.current) return;

    const requestId = ++requestIdRef.current;
    onLoadingRef.current(true);
    onErrorRef.current('');

    try {
      const result = await fetchParcels(query, controller.signal);
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;

      lastFetchKeyRef.current = fetchKey;
      renderParcels(result.items, showGeometry);
      onUpdateRef.current(result, zoom);

      if (fitToResultsRef.current && result.items.length) {
        suppressEventsRef.current = true;
        const fitBounds = L.latLngBounds(
          result.items.map((p) => [p.latitude, p.longitude] as [number, number]),
        );
        map.fitBounds(fitBounds, { padding: [32, 32], maxZoom: 16 });
        map.once('moveend', () => {
          suppressEventsRef.current = false;
        });
      }
    } catch (err) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      onErrorRef.current(err instanceof Error ? err.message : 'Lỗi tải dữ liệu');
    } finally {
      if (requestId === requestIdRef.current) {
        onLoadingRef.current(false);
      }
    }
  }, [map, renderParcels]);

  const scheduleFetch = useCallback(() => {
    if (suppressEventsRef.current) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runFetch();
    }, DEBOUNCE_MS);
  }, [runFetch]);

  useMapEvents({
    moveend: scheduleFetch,
  });

  useEffect(() => {
    lastFetchKeyRef.current = '';
    scheduleFetch();
  }, [filtersVersion, scheduleFetch]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      renderGenRef.current += 1;
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }
    };
  }, []);

  return null;
}
