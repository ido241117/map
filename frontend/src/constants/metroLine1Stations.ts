/** Metro số 1 Bến Thành – Suối Tiên — tọa độ từ OSM platform, tên hardcode theo thứ tự tuyến. */
export type MetroStationLevel = 'elevated' | 'underground';

export type MetroLine1Station = {
  order: number;
  name: string;
  level: MetroStationLevel;
  /** [lng, lat] */
  coordinates: [number, number];
};

export const METRO_LINE1_STATIONS: MetroLine1Station[] = [
  { order: 1, name: 'Bến xe Suối Tiên', level: 'elevated', coordinates: [106.814397, 10.87998] },
  { order: 2, name: 'Đại học Quốc gia', level: 'elevated', coordinates: [106.800857, 10.866171] },
  { order: 3, name: 'Khu Công nghệ cao', level: 'elevated', coordinates: [106.789317, 10.859347] },
  { order: 4, name: 'Thủ Đức', level: 'elevated', coordinates: [106.771872, 10.846925] },
  { order: 5, name: 'Bình Thái', level: 'elevated', coordinates: [106.764117, 10.833181] },
  { order: 6, name: 'Phước Long', level: 'elevated', coordinates: [106.758265, 10.822004] },
  { order: 7, name: 'Rạch Chiếc', level: 'elevated', coordinates: [106.755447, 10.80902] },
  { order: 8, name: 'An Phú', level: 'elevated', coordinates: [106.742525, 10.802198] },
  { order: 9, name: 'Thảo Điền', level: 'elevated', coordinates: [106.73327, 10.800478] },
  { order: 10, name: 'Tân Cảng', level: 'elevated', coordinates: [106.723292, 10.798679] },
  { order: 11, name: 'Công viên Văn Thánh', level: 'elevated', coordinates: [106.714989, 10.795729] },
  { order: 12, name: 'Ba Son', level: 'underground', coordinates: [106.707706, 10.781266] },
  { order: 13, name: 'Nhà hát Thành phố', level: 'underground', coordinates: [106.701829, 10.775262] },
  { order: 14, name: 'Bến Thành', level: 'underground', coordinates: [106.698262, 10.771566] },
];

export function metroLine1StationsGeoJson(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: METRO_LINE1_STATIONS.map((station) => ({
      type: 'Feature',
      properties: {
        order: station.order,
        name: station.name,
        level: station.level,
        line: 'L1',
      },
      geometry: {
        type: 'Point',
        coordinates: station.coordinates,
      },
    })),
  };
}
