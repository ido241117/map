'use strict';

/** z16 viewport ~5k polygon quanh Pasteur / Q1 (zoom 16.3 trên UI). */
const PARCEL_Z16_VIEWPORT_CENTER = [
  '/tiles/land-parcels/16/52191/30793',
  '/tiles/land-parcels/16/52191/30794',
  '/tiles/land-parcels/16/52191/30795',
  '/tiles/land-parcels/16/52191/30796',
  '/tiles/land-parcels/16/52191/30797',
  '/tiles/land-parcels/16/52192/30793',
  '/tiles/land-parcels/16/52192/30794',
  '/tiles/land-parcels/16/52192/30795',
  '/tiles/land-parcels/16/52192/30796',
  '/tiles/land-parcels/16/52192/30797',
  '/tiles/land-parcels/16/52193/30793',
  '/tiles/land-parcels/16/52193/30794',
  '/tiles/land-parcels/16/52193/30795',
  '/tiles/land-parcels/16/52193/30796',
  '/tiles/land-parcels/16/52193/30797',
  '/tiles/land-parcels/16/52194/30793',
  '/tiles/land-parcels/16/52194/30794',
  '/tiles/land-parcels/16/52194/30795',
  '/tiles/land-parcels/16/52194/30796',
  '/tiles/land-parcels/16/52194/30797',
  '/tiles/land-parcels/16/52195/30793',
  '/tiles/land-parcels/16/52195/30794',
  '/tiles/land-parcels/16/52195/30795',
  '/tiles/land-parcels/16/52195/30796',
  '/tiles/land-parcels/16/52195/30797',
];

/** Pan nhẹ sang phải — ~40% tile mới (MapLibre giữ overlap). */
const PARCEL_Z16_VIEWPORT_EAST = [
  '/tiles/land-parcels/16/52192/30793',
  '/tiles/land-parcels/16/52192/30794',
  '/tiles/land-parcels/16/52192/30795',
  '/tiles/land-parcels/16/52192/30796',
  '/tiles/land-parcels/16/52192/30797',
  '/tiles/land-parcels/16/52193/30793',
  '/tiles/land-parcels/16/52193/30794',
  '/tiles/land-parcels/16/52193/30795',
  '/tiles/land-parcels/16/52193/30796',
  '/tiles/land-parcels/16/52193/30797',
  '/tiles/land-parcels/16/52194/30793',
  '/tiles/land-parcels/16/52194/30794',
  '/tiles/land-parcels/16/52194/30795',
  '/tiles/land-parcels/16/52194/30796',
  '/tiles/land-parcels/16/52194/30797',
  '/tiles/land-parcels/16/52195/30793',
  '/tiles/land-parcels/16/52195/30794',
  '/tiles/land-parcels/16/52195/30795',
  '/tiles/land-parcels/16/52195/30796',
  '/tiles/land-parcels/16/52195/30797',
  '/tiles/land-parcels/16/52196/30793',
  '/tiles/land-parcels/16/52196/30794',
  '/tiles/land-parcels/16/52196/30795',
  '/tiles/land-parcels/16/52196/30796',
  '/tiles/land-parcels/16/52196/30797',
];

/** Pan nhẹ lên — viewport lệch phía bắc. */
const PARCEL_Z16_VIEWPORT_NORTH = [
  '/tiles/land-parcels/16/52191/30792',
  '/tiles/land-parcels/16/52191/30793',
  '/tiles/land-parcels/16/52191/30794',
  '/tiles/land-parcels/16/52191/30795',
  '/tiles/land-parcels/16/52191/30796',
  '/tiles/land-parcels/16/52192/30792',
  '/tiles/land-parcels/16/52192/30793',
  '/tiles/land-parcels/16/52192/30794',
  '/tiles/land-parcels/16/52192/30795',
  '/tiles/land-parcels/16/52192/30796',
  '/tiles/land-parcels/16/52193/30792',
  '/tiles/land-parcels/16/52193/30793',
  '/tiles/land-parcels/16/52193/30794',
  '/tiles/land-parcels/16/52193/30795',
  '/tiles/land-parcels/16/52193/30796',
  '/tiles/land-parcels/16/52194/30792',
  '/tiles/land-parcels/16/52194/30793',
  '/tiles/land-parcels/16/52194/30794',
  '/tiles/land-parcels/16/52194/30795',
  '/tiles/land-parcels/16/52194/30796',
  '/tiles/land-parcels/16/52195/30792',
  '/tiles/land-parcels/16/52195/30793',
  '/tiles/land-parcels/16/52195/30794',
  '/tiles/land-parcels/16/52195/30795',
  '/tiles/land-parcels/16/52195/30796',
];

/** QHSDD layer — MapLibre overzoom từ z12; load lúc vào vùng. */
const QHSDD_BOOTSTRAP_TILES = [
  '/tiles/qhsdd/10/814/480',
  '/tiles/qhsdd/10/814/481',
  '/tiles/qhsdd/10/815/480',
  '/tiles/qhsdd/10/815/481',
];

/** OSM highways — cùng z/x/y với parcels (minzoom 16 trên UI). */
function highwaysFromParcels(parcelPaths) {
  return parcelPaths.map((p) => p.replace('/tiles/land-parcels/', '/tiles/highways/'));
}

function withHighways(parcelPaths) {
  return [...parcelPaths, ...highwaysFromParcels(parcelPaths)];
}

const MAP_PAN_VIEWPORTS = [
  PARCEL_Z16_VIEWPORT_CENTER,
  PARCEL_Z16_VIEWPORT_EAST,
  PARCEL_Z16_VIEWPORT_NORTH,
];

/** Viewports gồm cả parcels + highways (gần đúng UI khi bật lớp đường). */
const MAP_PAN_VIEWPORTS_WITH_HIGHWAYS = MAP_PAN_VIEWPORTS.map(withHighways);

module.exports = {
  PARCEL_Z16_VIEWPORT_CENTER,
  MAP_PAN_VIEWPORTS,
  MAP_PAN_VIEWPORTS_WITH_HIGHWAYS,
  QHSDD_BOOTSTRAP_TILES,
  highwaysFromParcels,
  withHighways,
};
