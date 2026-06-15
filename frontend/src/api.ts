import type { Parcel, Stats } from './types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export type ParcelQuery = {
  q?: string;
  district?: string;
  ward?: string;
  landType?: string;
  minArea?: string;
  maxArea?: string;
  limit?: string;
};

function toQueryString(query: ParcelQuery) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, value);
  });

  return params.toString();
}

export async function fetchParcels(query: ParcelQuery): Promise<Parcel[]> {
  const qs = toQueryString(query);
  const response = await fetch(`${API_URL}/parcels${qs ? `?${qs}` : ''}`);
  if (!response.ok) throw new Error('Không tải được danh sách thửa đất');
  return response.json();
}

export async function fetchStats(): Promise<Stats> {
  const response = await fetch(`${API_URL}/stats`);
  if (!response.ok) throw new Error('Không tải được thống kê');
  return response.json();
}
