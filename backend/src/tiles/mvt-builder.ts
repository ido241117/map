import {
  HCM_PROVINCE_CODE,
  LAND_PARCELS_LAYER,
  MVT_BUFFER,
  MVT_EXTENT,
  QHSDD_LAYER,
  TILE_FEATURE_LIMIT,
  type TileKind,
} from './tile-config';

type MvtQuery = {
  sql: string;
  params: unknown[];
  layerName: string;
};

export type AdminTileFilter = {
  district?: string;
  ward?: string;
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
  admin?: AdminTileFilter,
): MvtQuery {
  const params: unknown[] = [z, x, y];
  const useSimplify = tolerance > 0;
  const toleranceParam = useSimplify ? '$4' : null;
  if (useSimplify) {
    params.push(tolerance);
  }

  const conditions = ['geom IS NOT NULL', TILE_INTERSECTS];

  params.push(HCM_PROVINCE_CODE);
  conditions.unshift(`province_code = $${params.length}`);

  if (admin?.district?.trim()) {
    params.push(admin.district.trim());
    conditions.push(`district = $${params.length}`);
  }
  if (admin?.ward?.trim()) {
    params.push(admin.ward.trim());
    conditions.push(`ward = $${params.length}`);
  }

  const whereSql = conditions.join('\n          AND ');
  const featureLimit =
    admin?.district?.trim() || admin?.ward?.trim() ? '' : `LIMIT ${TILE_FEATURE_LIMIT}`;

  return {
    layerName: LAND_PARCELS_LAYER,
    params,
    sql: `
      SELECT ST_AsMVT(mvt_row, '${LAND_PARCELS_LAYER}', ${MVT_EXTENT}, 'geom') AS tile
      FROM (
        SELECT
          id,
          property_code,
          district,
          ward,
          ${buildGeomSql(toleranceParam)} AS geom
        FROM land_parcels
        WHERE ${whereSql}
        ${featureLimit}
      ) AS mvt_row
    `,
  };
}

export function buildQhsddMvtQuery(
  z: number,
  x: number,
  y: number,
  tolerance: number,
  admin?: AdminTileFilter,
): MvtQuery {
  const useSimplify = tolerance > 0;
  const toleranceParam = useSimplify ? '$4' : null;
  const params: unknown[] = useSimplify ? [z, x, y, tolerance] : [z, x, y];

  const conditions = ['geom IS NOT NULL', TILE_INTERSECTS];

  if (admin?.district?.trim()) {
    params.push(admin.district.trim());
    conditions.push(`district = $${params.length}`);
  }
  if (admin?.ward?.trim()) {
    params.push(admin.ward.trim());
    conditions.push(`ward = $${params.length}`);
  }

  const whereSql = conditions.join('\n          AND ');

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
          district,
          ward,
          ${buildGeomSql(toleranceParam)} AS geom
        FROM hcm_qhsdd
        WHERE ${whereSql}
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
  admin?: AdminTileFilter,
): MvtQuery {
  if (kind === 'land-parcels') {
    return buildLandParcelsMvtQuery(z, x, y, tolerance, admin);
  }
  return buildQhsddMvtQuery(z, x, y, tolerance, admin);
}
