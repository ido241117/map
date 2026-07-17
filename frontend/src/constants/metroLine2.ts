import type { FilterSpecification } from 'maplibre-gl';

/** Metro số 2 — thông tin tuyến (popup click trên line). */
export const METRO_LINE2_INFO = {
  name: 'Tuyến metro số 2 (Bến Thành – Tham Lương)',
  lengthKm: 11.3,
  stations: 11,
  stationsDetail: '10 ga ngầm + 1 ga trên cao',
  status: 'Đang xây dựng',
} as const;

/**
 * MapLibre filter: OSM `construction` segments thuộc L2.
 * (ref L2/UMRT2 hoặc tên chứa Tham Lương / số 2 / Metro Số 2)
 */
export const METRO_LINE2_FILTER: FilterSpecification = [
  'all',
  ['==', ['get', 'railway'], 'construction'],
  [
    'any',
    ['==', ['get', 'ref'], 'L2'],
    ['==', ['get', 'ref'], 'UMRT2'],
    ['>=', ['index-of', 'Tham Lương', ['coalesce', ['get', 'name'], '']], 0],
    ['>=', ['index-of', 'Metro Số 2', ['coalesce', ['get', 'name'], '']], 0],
    ['>=', ['index-of', 'Metro số 2', ['coalesce', ['get', 'name'], '']], 0],
    ['>=', ['index-of', 'Tuyến số 2', ['coalesce', ['get', 'name'], '']], 0],
    ['>=', ['index-of', 'đô thị số 2', ['coalesce', ['get', 'name'], '']], 0],
  ],
];
