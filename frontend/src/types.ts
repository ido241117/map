export type ParcelSource = 'land_parcels' | 'guland_hcm_land';

export const PARCEL_SOURCE_OPTIONS: Array<{ value: ParcelSource; label: string }> = [
  { value: 'land_parcels', label: 'Land Parcels (gốc)' },
  { value: 'guland_hcm_land', label: 'Guland HCM' },
];

export type User = {
  id: number;
  email: string;
  displayName: string | null;
};

export type AuthResponse = {
  token: string;
  user: User;
};

export type Parcel = {
  id: number;
  shape_file_id: string;
  property_code: string;
  address: string;
  latitude: number;
  longitude: number;
  total_area: number;
  planning_land_type: string;
  province: string;
  district: string;
  ward: string;
  property_uuid: string;
  geometry_json?: GeoJSON.MultiPolygon;
};

export type ParcelAddressSuggestion = {
  id: number;
  source: ParcelSource;
  address: string;
  full_address: string;
  ward: string;
  district: string;
  province: string;
  property_code: string;
  latitude: number;
  longitude: number;
  score: number;
};

export type ParcelAddressSuggestResponse = {
  source: ParcelSource;
  items: ParcelAddressSuggestion[];
  engine: 'elasticsearch' | 'unavailable';
};

export type ParcelListResponse = {
  source: ParcelSource;
  items: Parcel[];
  truncated: boolean;
  returned: number;
};

export type Stats = {
  source: ParcelSource;
  summary: {
    parcel_count: number;
    avg_area: number;
    min_area: number;
    max_area: number;
  };
  districts: Array<{ district: string; count: number }>;
  landTypes: Array<{ planning_land_type: string; count: number }>;
  wards: Array<{ district: string; ward: string; count: number }>;
};

export type PropertyBuyRecord = {
  id: number;
  record_id: number;
  customer_name: string | null;
  address: string;
  street: string;
  ward: string;
  district: string;
  city: string;
  price_buy: number;
  imported_at: string;
};

export type PropertyBuyListResponse = {
  items: PropertyBuyRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type PropertyBuyFilterOptions = {
  districts: Array<{ district: string; count: number }>;
  wards: Array<{ district: string; ward: string; count: number }>;
};

export type MapBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};
