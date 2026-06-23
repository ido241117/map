import {
  HCM_PROVINCE_CODE,
  LAND_PARCELS_LAYER,
  MVT_BUFFER,
  MVT_EXTENT,
  QHSDD_LAYER,
  type TileKind,
} from './tile-config';

type MvtQuery = {
  sql: string;
  params: unknown[];
  layerName: string;
};

/** Tile envelope is EPSG:3857; stored geom is EPSG:4326. */
const TILE_INTERSECTS = 'geom && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)';

function buildGeomSql(toleranceParam: string | null): string {
  const geom = toleranceParam
    ? `ST_Simplify(geom, ${toleranceParam}::double precision)`
    : 'geom';
  return `ST_AsMVTGeom(ST_Transform(${geom}, 3857), ST_TileEnvelope($1, $2, $3), ${MVT_EXTENT}, ${MVT_BUFFER}, true)`;
}

export function buildLandParcelsMvtQuery(
  z: number,
  x: number,
  y: number,
  tolerance: number,
): MvtQuery {
  const useSimplify = tolerance > 0;
  const toleranceParam = useSimplify ? '$4' : null;
  const provinceParam = useSimplify ? '$5' : '$4';
  const params = useSimplify
    ? [z, x, y, tolerance, HCM_PROVINCE_CODE]
    : [z, x, y, HCM_PROVINCE_CODE];

  return {
    layerName: LAND_PARCELS_LAYER,
    params,
    sql: `
      SELECT ST_AsMVT(mvt_row, '${LAND_PARCELS_LAYER}', ${MVT_EXTENT}, 'geom') AS tile
      FROM (
        SELECT
          id,
          property_code,
          ${buildGeomSql(toleranceParam)} AS geom
        FROM land_parcels
        WHERE province_code = ${provinceParam}
          AND geom IS NOT NULL
          AND ${TILE_INTERSECTS}
      ) AS mvt_row
    `,
  };
}

export function buildQhsddMvtQuery(
  z: number,
  x: number,
  y: number,
  tolerance: number,
): MvtQuery {
  const useSimplify = tolerance > 0;
  const toleranceParam = useSimplify ? '$4' : null;
  const params = useSimplify ? [z, x, y, tolerance] : [z, x, y];

  return {
    layerName: QHSDD_LAYER,
    params,
    sql: `
      SELECT ST_AsMVT(mvt_row, '${QHSDD_LAYER}', ${MVT_EXTENT}, 'geom') AS tile
      FROM (
        SELECT
          id,
          loai_dat_quy_hoach,
          fill_hex,
          ${buildGeomSql(toleranceParam)} AS geom
        FROM hcm_qhsdd
        WHERE geom IS NOT NULL
          AND ${TILE_INTERSECTS}
      ) AS mvt_row
    `,
  };
}

export function buildMvtQuery(
  kind: TileKind,
  z: number,
  x: number,
  y: number,
  tolerance: number,
): MvtQuery {
  if (kind === 'land-parcels') {
    return buildLandParcelsMvtQuery(z, x, y, tolerance);
  }
  return buildQhsddMvtQuery(z, x, y, tolerance);
}
