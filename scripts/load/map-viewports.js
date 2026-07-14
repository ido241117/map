'use strict';

/** Build a wxh grid of land-parcels paths at zoom z. */
function parcelGrid(z, x0, y0, w, h) {
  const paths = [];
  for (let x = x0; x < x0 + w; x++) {
    for (let y = y0; y < y0 + h; y++) {
      paths.push(`/tiles/land-parcels/${z}/${x}/${y}`);
    }
  }
  return paths;
}

/** z16 viewport ~5k polygon quanh Pasteur / Q1 (zoom 16.3 trên UI). */
const PARCEL_Z16_VIEWPORT_CENTER = parcelGrid(16, 52191, 30793, 5, 5);
/** Pan nhẹ sang phải — ~40% tile mới (MapLibre giữ overlap). */
const PARCEL_Z16_VIEWPORT_EAST = parcelGrid(16, 52192, 30793, 5, 5);
/** Pan nhẹ lên — viewport lệch phía bắc. */
const PARCEL_Z16_VIEWPORT_NORTH = parcelGrid(16, 52191, 30792, 5, 5);

/**
 * z17 — cùng ~5×5 tile trên màn hình (giống mật độ request z16),
 * mỗi tile phủ 1/4 diện tích → ít polygon/tile hơn.
 * Center ≈ child của z16 52193/30795.
 */
const PARCEL_Z17_VIEWPORT_CENTER = parcelGrid(17, 104385, 61589, 5, 5);
const PARCEL_Z17_VIEWPORT_EAST = parcelGrid(17, 104387, 61589, 5, 5);
const PARCEL_Z17_VIEWPORT_NORTH = parcelGrid(17, 104385, 61587, 5, 5);

/** QHSDD layer — MapLibre overzoom từ z12; load lúc vào vùng. */
const QHSDD_BOOTSTRAP_TILES = [
  '/tiles/qhsdd/10/814/480',
  '/tiles/qhsdd/10/814/481',
  '/tiles/qhsdd/10/815/480',
  '/tiles/qhsdd/10/815/481',
];

/** OSM highways — cùng z/x/y với parcels. */
function highwaysFromParcels(parcelPaths) {
  return parcelPaths.map((p) => p.replace('/tiles/land-parcels/', '/tiles/highways/'));
}

function withHighways(parcelPaths) {
  return [...parcelPaths, ...highwaysFromParcels(parcelPaths)];
}

const MAP_PAN_VIEWPORTS_Z16 = [
  PARCEL_Z16_VIEWPORT_CENTER,
  PARCEL_Z16_VIEWPORT_EAST,
  PARCEL_Z16_VIEWPORT_NORTH,
];

const MAP_PAN_VIEWPORTS_Z17 = [
  PARCEL_Z17_VIEWPORT_CENTER,
  PARCEL_Z17_VIEWPORT_EAST,
  PARCEL_Z17_VIEWPORT_NORTH,
];

/** @deprecated alias — mặc định z16 */
const MAP_PAN_VIEWPORTS = MAP_PAN_VIEWPORTS_Z16;
const MAP_PAN_VIEWPORTS_WITH_HIGHWAYS = MAP_PAN_VIEWPORTS_Z16.map(withHighways);
const MAP_PAN_VIEWPORTS_Z17_WITH_HIGHWAYS = MAP_PAN_VIEWPORTS_Z17.map(withHighways);

/**
 * Chọn viewport theo zoom. LOAD_ZOOM=17 → z17 (tile nhẹ hơn / diện tích nhỏ hơn).
 * Lưu ý UI hiện maxzoom source=16: MapLibre overzoom z17 vẫn gọi URL z16.
 */
function viewportsForZoom(zoom, withHw) {
  const z = Number(zoom) === 17 ? 17 : 16;
  if (z === 17) {
    return withHw ? MAP_PAN_VIEWPORTS_Z17_WITH_HIGHWAYS : MAP_PAN_VIEWPORTS_Z17;
  }
  return withHw ? MAP_PAN_VIEWPORTS_WITH_HIGHWAYS : MAP_PAN_VIEWPORTS_Z16;
}

module.exports = {
  PARCEL_Z16_VIEWPORT_CENTER,
  PARCEL_Z17_VIEWPORT_CENTER,
  MAP_PAN_VIEWPORTS,
  MAP_PAN_VIEWPORTS_WITH_HIGHWAYS,
  MAP_PAN_VIEWPORTS_Z17,
  MAP_PAN_VIEWPORTS_Z17_WITH_HIGHWAYS,
  QHSDD_BOOTSTRAP_TILES,
  highwaysFromParcels,
  withHighways,
  viewportsForZoom,
};
