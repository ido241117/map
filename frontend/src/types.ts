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
  geometry_json: GeoJSON.MultiPolygon;
};

export type Stats = {
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
