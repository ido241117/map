import {
  HCM_PROVINCE_CODE,
  LAND_PARCELS_HOUSE_LAYER,
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

/**
 * Compact house number for map labels (matches frontend `extractHouseNo`).
 * "Số 6B" → "6B"; plain "73" / "54A" / "107/112/5" kept; empty first segment → NULL.
 */
function houseNoSql(addressExpr: string): string {
  const first = `btrim(split_part(${addressExpr}, ',', 1))`;
  return `
          NULLIF(
            COALESCE(
              NULLIF(substring(${first} from '^S.\\s+(\\S.*)$'), ''),
              CASE
                WHEN ${first}
                  ~ '^[0-9]+[A-Za-z]?(/[0-9]+[A-Za-z]?)*(\\s*\\([^)]*\\))?$'
                THEN ${first}
              END,
              CASE
                WHEN ${first}
                  ~* '^[A-Za-z][0-9]+[A-Za-z]?(\\s*\\([^)]*\\))?$'
                THEN ${first}
              END
            ),
            ''
          )`.trim();
}

function buildGeomSql(toleranceParam: string | null, geomExpr = 'tp.geom'): string {
  const geom = toleranceParam
    ? `ST_Simplify(${geomExpr}, ${toleranceParam}::double precision)`
    : geomExpr;
  return `ST_AsMVTGeom(ST_Transform(${geom}, 3857), tile.env_3857, ${MVT_EXTENT}, ${MVT_BUFFER}, true)`;
}

function buildCentroidMvtGeomSql(centroidExpr = 'tp.centroid'): string {
  return `ST_AsMVTGeom(ST_Transform(${centroidExpr}, 3857), tile.env_3857, ${MVT_EXTENT}, ${MVT_BUFFER}, true)`;
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

  params.push(HCM_PROVINCE_CODE);
  const provinceRef = `$${params.length}`;

  // One limited set for both polygon + house layers — independent LIMITs dropped labels
  // while the parcel fill still rendered.
  const parcelConditions = [
    `lp.province_code = ${provinceRef}`,
    'lp.geom IS NOT NULL',
    'lp.geom && tile.env_4326',
  ];

  if (admin?.district?.trim()) {
    params.push(admin.district.trim());
    parcelConditions.push(`lp.district = $${params.length}`);
  }
  if (admin?.ward?.trim()) {
    params.push(admin.ward.trim());
    parcelConditions.push(`lp.ward = $${params.length}`);
  }

  const parcelWhere = parcelConditions.join('\n            AND ');
  const featureLimit =
    admin?.district?.trim() || admin?.ward?.trim()
      ? ''
      : `ORDER BY lp.id LIMIT ${TILE_FEATURE_LIMIT}`;

  // MVT_BUFFER on ST_AsMVTGeom keeps edge centroids in the tile even when the point
  // sits slightly outside the unbuffered envelope.
  return {
    layerName: LAND_PARCELS_LAYER,
    params,
    sql: `
      WITH tile AS (
        SELECT
          ST_TileEnvelope($1, $2, $3) AS env_3857,
          ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS env_4326
      ),
      tile_parcels AS (
        SELECT
          lp.id,
          lp.property_code,
          lp.district,
          lp.ward,
          lp.geom,
          lp.centroid,
          ${houseNoSql('lp.address')} AS house_no
        FROM land_parcels lp, tile
        WHERE ${parcelWhere}
        ${featureLimit}
      )
      SELECT (
        SELECT ST_AsMVT(mvt_row, '${LAND_PARCELS_LAYER}', ${MVT_EXTENT}, 'geom')
        FROM (
          SELECT
            tp.id,
            tp.property_code,
            tp.district,
            tp.ward,
            tp.house_no,
            ${buildGeomSql(toleranceParam)} AS geom
          FROM tile_parcels tp, tile
        ) AS mvt_row
      ) || (
        SELECT COALESCE(ST_AsMVT(lbl_row, '${LAND_PARCELS_HOUSE_LAYER}', ${MVT_EXTENT}, 'geom'), ''::bytea)
        FROM (
          SELECT
            -- Do not name this \`id\` — ST_AsMVT would reuse parcel feature IDs and
            -- MapLibre cross-tile symbol matching can drop labels in dense clusters.
            tp.id AS parcel_id,
            tp.house_no,
            ${buildCentroidMvtGeomSql()} AS geom
          FROM tile_parcels tp, tile
          WHERE tp.house_no IS NOT NULL
            AND tp.centroid IS NOT NULL
        ) AS lbl_row
      ) AS tile
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

  const conditions = ['geom IS NOT NULL', 'geom && tile.env_4326'];

  if (admin?.district?.trim()) {
    params.push(admin.district.trim());
    conditions.push(`district = $${params.length}`);
  }
  if (admin?.ward?.trim()) {
    params.push(admin.ward.trim());
    conditions.push(`ward = $${params.length}`);
  }

  const whereSql = conditions.join('\n            AND ');
  const geomSql = toleranceParam
    ? `ST_AsMVTGeom(ST_Transform(ST_Simplify(geom, ${toleranceParam}::double precision), 3857), tile.env_3857, ${MVT_EXTENT}, ${MVT_BUFFER}, true)`
    : `ST_AsMVTGeom(ST_Transform(geom, 3857), tile.env_3857, ${MVT_EXTENT}, ${MVT_BUFFER}, true)`;

  return {
    layerName: QHSDD_LAYER,
    params,
    sql: `
      WITH tile AS (
        SELECT
          ST_TileEnvelope($1, $2, $3) AS env_3857,
          ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS env_4326
      )
      SELECT ST_AsMVT(mvt_row, '${QHSDD_LAYER}', ${MVT_EXTENT}, 'geom') AS tile
      FROM (
        SELECT
          q.id,
          q.loai_dat_quy_hoach,
          q.fill_hex,
          q.district,
          q.ward,
          ${geomSql} AS geom
        FROM hcm_qhsdd q, tile
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
