import type { QhsddZone } from '../types';

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygonCoords(lng: number, lat: number, rings: number[][][]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !pointInRing(lng, lat, outer)) return false;
  return holes.every((hole) => !pointInRing(lng, lat, hole));
}

export function pointInGeometry(lng: number, lat: number, geometry: GeoJSON.Geometry): boolean {
  if (geometry.type === 'Polygon') {
    return pointInPolygonCoords(lng, lat, geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInPolygonCoords(lng, lat, polygon));
  }
  return false;
}

export function findQhsddZoneAt(
  lat: number,
  lng: number,
  zones: QhsddZone[],
): QhsddZone | undefined {
  for (const zone of zones) {
    if (pointInGeometry(lng, lat, zone.geometry_json)) {
      return zone;
    }
  }
  return undefined;
}

export function describeLandColor(zone: QhsddZone): string {
  const r = Number(zone.red) || 0;
  const g = Number(zone.green) || 0;
  const b = Number(zone.blue) || 0;
  const hex = zone.fill_hex || '#888888';
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (max < 40) return `Màu đen / xám đậm (${hex})`;
  if (delta < 20 && max > 90) return `Màu xám (${hex})`;

  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
    if (hue < 0) hue += 360;
  }

  if (hue < 15 || hue >= 345) {
    if (g > 90 && b > 90) return `Màu hồng (${hex})`;
    return `Màu đỏ (${hex})`;
  }
  if (hue < 40) {
    if (max > 210) return `Màu cam nhạt / be (${hex})`;
    if (max < 140) return `Màu nâu / cam đậm (${hex})`;
    return `Màu cam (${hex})`;
  }
  if (hue < 65) return `Màu vàng / kem (${hex})`;
  if (hue < 150) return `Màu xanh lá (${hex})`;
  if (hue < 200) return `Màu xanh ngọc (${hex})`;
  if (hue < 250) return `Màu xanh dương (${hex})`;
  if (hue < 290) return `Màu tím (${hex})`;
  return `Màu hồng (${hex})`;
}
