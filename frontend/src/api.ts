import type { ParcelListResponse, Stats } from './types';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export type ParcelQuery = {
  q?: string;
  district?: string;
  ward?: string;
  landType?: string;
  minArea?: string;
  maxArea?: string;
  minLat?: string;
  maxLat?: string;
  minLng?: string;
  maxLng?: string;
  includeGeometry?: string;
  limit?: string;
};

function toQueryString(query: ParcelQuery) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, value);
  });

  return params.toString();
}

export async function fetchParcels(
  query: ParcelQuery,
  signal?: AbortSignal,
): Promise<ParcelListResponse> {
  const qs = toQueryString(query);
  const response = await fetch(`${API_URL}/parcels${qs ? `?${qs}` : ''}`, { signal });
  if (!response.ok) throw new Error('Không tải được danh sách thửa đất');
  return response.json();
}

export async function fetchStats(): Promise<Stats> {
  const response = await fetch(`${API_URL}/stats`);
  if (!response.ok) throw new Error('Không tải được thống kê');
  return response.json();
}
