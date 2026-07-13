/**
 * Edge-length labels for a selected parcel polygon.
 *
 * Visibility formula calibrated on RP26740926281743387
 * (Số 6B Thi Sách — 21 edges, max ≈ 12.8 m): keep major sides only
 * (≈5 labels), hide jogs / notches that clutter the map.
 *
 * Show edge if length_m >= max(EDGE_LABEL_FLOOR_M, maxEdge * EDGE_LABEL_RATIO)
 * when maxEdge is large; for small lots use a relative floor so thin
 * rectangles still get their long sides labeled.
 */

const EARTH_RADIUS_M = 6_371_008.8;

/** Absolute floor (m) for typical urban lots — calibrated on Thi Sách case. */
export const EDGE_LABEL_FLOOR_M = 6;

/** Relative to longest edge — calibrated so 5.07 / 5.28 m sides stay hidden. */
export const EDGE_LABEL_RATIO = 0.2;

/** Soft cap after filtering (longest first). */
export const EDGE_LABEL_MAX_COUNT = 6;

/** Below this max-edge, switch to relative-only threshold (small parcels). */
const SMALL_LOT_MAX_EDGE_M = 8;
const SMALL_LOT_RATIO = 0.65;

export type ParcelEdgeLabel = {
  lengthM: number;
  midLng: number;
  midLat: number;
  /** Degrees clockwise from north for MapLibre `text-rotate` (readable). */
  angle: number;
};

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in meters (WGS84 sphere). */
export function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing degrees [0, 360) from north, clockwise. */
function bearingDegrees(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Keep label upright while roughly following the edge. */
function readableLabelAngle(bearing: number): number {
  let angle = bearing;
  if (angle > 90 && angle <= 270) angle -= 180;
  return angle;
}

function ringFromGeometry(geometry: GeoJSON.Geometry): [number, number][] | null {
  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0];
    return ring?.length ? (ring as [number, number][]) : null;
  }
  if (geometry.type === 'MultiPolygon') {
    const ring = geometry.coordinates[0]?.[0];
    return ring?.length ? (ring as [number, number][]) : null;
  }
  return null;
}

export function edgeLabelThresholdMeters(maxEdgeM: number): number {
  if (!(maxEdgeM > 0)) return EDGE_LABEL_FLOOR_M;
  if (maxEdgeM < SMALL_LOT_MAX_EDGE_M) return maxEdgeM * SMALL_LOT_RATIO;
  return Math.max(EDGE_LABEL_FLOOR_M, maxEdgeM * EDGE_LABEL_RATIO);
}

export function computeParcelEdgeLabels(geometry: GeoJSON.Geometry): ParcelEdgeLabel[] {
  const ring = ringFromGeometry(geometry);
  if (!ring || ring.length < 2) return [];

  const edges: ParcelEdgeLabel[] = [];
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    if (
      !Number.isFinite(lng1) ||
      !Number.isFinite(lat1) ||
      !Number.isFinite(lng2) ||
      !Number.isFinite(lat2)
    ) {
      continue;
    }
    const lengthM = haversineMeters(lng1, lat1, lng2, lat2);
    if (!(lengthM > 0.05)) continue;
    edges.push({
      lengthM,
      midLng: (lng1 + lng2) / 2,
      midLat: (lat1 + lat2) / 2,
      angle: readableLabelAngle(bearingDegrees(lng1, lat1, lng2, lat2)),
    });
  }

  if (!edges.length) return [];

  const maxEdge = Math.max(...edges.map((e) => e.lengthM));
  const threshold = edgeLabelThresholdMeters(maxEdge);

  return edges
    .filter((e) => e.lengthM >= threshold)
    .sort((a, b) => b.lengthM - a.lengthM)
    .slice(0, EDGE_LABEL_MAX_COUNT);
}

export function formatEdgeLabelMeters(lengthM: number): string {
  return `${lengthM.toFixed(1)} m`;
}

export function parcelEdgeLabelsToGeoJson(
  geometry: GeoJSON.Geometry | undefined | null,
): GeoJSON.FeatureCollection {
  if (!geometry) {
    return { type: 'FeatureCollection', features: [] };
  }

  const labels = computeParcelEdgeLabels(geometry);
  return {
    type: 'FeatureCollection',
    features: labels.map((label, index) => ({
      type: 'Feature' as const,
      id: index,
      properties: {
        label: formatEdgeLabelMeters(label.lengthM),
        length_m: Math.round(label.lengthM * 10) / 10,
        angle: label.angle,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [label.midLng, label.midLat],
      },
    })),
  };
}
