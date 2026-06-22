import type {
  AuthResponse,
  ParcelAddressSuggestResponse,
  ParcelListResponse,
  ParcelSource,
  PropertyBuyFilterOptions,
  PropertyBuyMapPointResponse,
  PropertyBuyListResponse,
  QhsddZoneListResponse,
  Stats,
  User,
} from './types';

const API_URL = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'hcm_land_token';

let authToken: string | null = localStorage.getItem(TOKEN_KEY);

export function getAuthToken() {
  return authToken;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export type ParcelQuery = {
  source?: ParcelSource;
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
  zoom?: string;
  limit?: string;
};

export type PropertyBuyQuery = {
  q?: string;
  district?: string;
  ward?: string;
  page?: number;
  pageSize?: number;
};

function toQueryString(query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return params.toString();
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = 'Yêu cầu thất bại';
    try {
      const body = await response.json();
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(', ');
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  return response.json();
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function register(
  email: string,
  password: string,
  displayName?: string,
): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // logout is best-effort for JWT
  }
}

export async function fetchMe(): Promise<User> {
  return apiFetch<User>('/auth/me');
}

export async function fetchParcelAddressSuggest(
  query: Pick<ParcelQuery, 'source' | 'q'> & { limit?: number },
  signal?: AbortSignal,
): Promise<ParcelAddressSuggestResponse> {
  const qs = toQueryString(query);
  return apiFetch<ParcelAddressSuggestResponse>(`/parcels/address-suggest?${qs}`, { signal });
}

export async function fetchParcels(
  query: ParcelQuery,
  signal?: AbortSignal,
): Promise<ParcelListResponse> {
  const qs = toQueryString(query);
  return apiFetch<ParcelListResponse>(`/parcels${qs ? `?${qs}` : ''}`, { signal });
}

export async function fetchStats(source: ParcelSource = 'land_parcels'): Promise<Stats> {
  const qs = toQueryString({ source });
  return apiFetch<Stats>(`/stats?${qs}`);
}

export type QhsddZoneQuery = {
  minLat?: string;
  maxLat?: string;
  minLng?: string;
  maxLng?: string;
  landType?: string;
  zoom?: string;
  limit?: string;
};

export async function fetchQhsddZones(
  query: QhsddZoneQuery,
  signal?: AbortSignal,
): Promise<QhsddZoneListResponse> {
  const qs = toQueryString(query);
  return apiFetch<QhsddZoneListResponse>(`/qhsdd/zones?${qs}`, { signal });
}

export async function fetchPropertyBuyRecords(
  query: PropertyBuyQuery,
): Promise<PropertyBuyListResponse> {
  const qs = toQueryString(query);
  return apiFetch<PropertyBuyListResponse>(
    `/property-buy-records${qs ? `?${qs}` : ''}`,
  );
}

export async function fetchPropertyBuyFilterOptions(): Promise<PropertyBuyFilterOptions> {
  return apiFetch<PropertyBuyFilterOptions>('/property-buy-records/filter-options');
}

export async function fetchPropertyBuyMapPoints(limit = 100): Promise<PropertyBuyMapPointResponse> {
  const qs = toQueryString({ limit });
  return apiFetch<PropertyBuyMapPointResponse>(`/property-buy-records/map-points?${qs}`);
}
