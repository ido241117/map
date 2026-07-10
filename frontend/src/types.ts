export type QhsddZone = {
  id: number;
  feature_id: string;
  loai_dat_quy_hoach: string;
  center_lat: number;
  center_long: number;
  red: number;
  green: number;
  blue: number;
  fill_hex: string;
  district?: string | null;
  ward?: string | null;
  geometry_json: GeoJSON.Geometry;
};

export type QhsddZoneListResponse = {
  items: QhsddZone[];
  returned: number;
  truncated: boolean;
};

export type ParcelSource = 'land_parcels' | 'property_buy_records';

export const PARCEL_SOURCE_OPTIONS: Array<{ value: ParcelSource; label: string }> = [
  { value: 'land_parcels', label: 'Thửa đất + QHSDD' },
  { value: 'property_buy_records', label: 'Địa chỉ giao dịch' },
];

export function isParcelDataSource(source: ParcelSource | undefined) {
  return source === 'land_parcels';
}

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
  geometry_json?: GeoJSON.Geometry;
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

export type MapCluster = {
  latitude: number;
  longitude: number;
  cluster_count: number;
};

export type ParcelListResponse = {
  source: ParcelSource;
  mode: 'parcels' | 'clusters';
  items: Parcel[];
  clusters: MapCluster[];
  truncated: boolean;
  returned: number;
  cluster_parcels?: number;
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
  string: string | null;
  lat: number | null;
  long: number | null;
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

export type PropertyBuyMapPoint = {
  id: number;
  record_id: number;
  address: string;
  string: string | null;
  lat: number;
  long: number;
};

export type PropertyBuyMapPointResponse = {
  items: PropertyBuyMapPoint[];
  total: number;
};

export type MapBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};
