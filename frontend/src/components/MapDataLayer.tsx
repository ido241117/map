import { useCallback, useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { fetchParcels, type ParcelQuery } from '../api';
import type { Parcel, ParcelListResponse } from '../types';

const GEOMETRY_ZOOM = 14;
const DEBOUNCE_MS = 350;

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
  onUpdate: (result: ParcelListResponse, zoom: number) => void;
  onLoading: (loading: boolean) => void;
  onError: (message: string) => void;
  fitToResults?: boolean;
};

export function MapDataLayer({
  filters,
  onUpdate,
  onLoading,
  onError,
  fitToResults = false,
}: MapDataLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const renderParcels = useCallback((parcels: Parcel[], showGeometry: boolean) => {
    if (layerRef.current) {
      layerRef.current.clearLayers();
    } else {
      layerRef.current = L.layerGroup().addTo(map);
    }

    const group = layerRef.current;

    if (showGeometry) {
      const features = parcels
        .filter((p) => p.geometry_json)
        .map((p) => ({
          type: 'Feature' as const,
          properties: p,
          geometry: p.geometry_json!,
        }));

      if (features.length) {
        const collection: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features,
        };
        L.geoJSON(collection, {
          style: () => POLYGON_STYLE,
          onEachFeature: (feature, layer) => {
            layer.bindPopup(popupHtml(feature.properties as Parcel), { maxWidth: 320 });
          },
        }).addTo(group);
      }
    } else {
      for (const parcel of parcels) {
        L.circleMarker([parcel.latitude, parcel.longitude], MARKER_STYLE)
          .bindPopup(popupHtml(parcel), { maxWidth: 320 })
          .addTo(group);
      }
    }
  }, [map]);

  const loadViewport = useCallback(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(async () => {
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
      };

      onLoading(true);
      onError('');

      try {
        const result = await fetchParcels(query, controller.signal);
        if (controller.signal.aborted) return;

        renderParcels(result.items, showGeometry);
        onUpdate(result, zoom);

        if (fitToResults && result.items.length) {
          const fitBounds = L.latLngBounds(
            result.items.map((p) => [p.latitude, p.longitude] as [number, number]),
          );
          map.fitBounds(fitBounds, { padding: [32, 32], maxZoom: 16 });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        onError(err instanceof Error ? err.message : 'Lỗi tải dữ liệu');
      } finally {
        if (!controller.signal.aborted) onLoading(false);
      }
    }, DEBOUNCE_MS);
  }, [map, onUpdate, onLoading, onError, fitToResults, renderParcels]);

  useMapEvents({
    moveend: loadViewport,
    zoomend: loadViewport,
  });

  useEffect(() => {
    loadViewport();
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }
    };
  }, [loadViewport, filters]);

  return null;
}
