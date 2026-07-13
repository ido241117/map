const { Client } = require('pg');
const path = require('path');

const DB_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/hcm_land_mvp';

async function main() {
  const { buildLandParcelsMvtQuery } = require(
    path.join(__dirname, '../backend/dist/tiles/mvt-builder'),
  );

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  const sample = await client.query(`
    WITH centroids AS (
      SELECT
        ST_X(ST_Centroid(geom)) AS lng,
        ST_Y(ST_Centroid(geom)) AS lat
      FROM land_parcels
      WHERE province_code = '79' AND geom IS NOT NULL
      LIMIT 5000
    ),
    tiles AS (
      SELECT
        17 AS z,
        FLOOR((lng + 180) / 360 * 131072)::int AS x,
        FLOOR(
          (1 - LN(TAN(RADIANS(lat)) + 1 / COS(RADIANS(lat))) / PI())
          / 2 * 131072
        )::int AS y
      FROM centroids
    )
    SELECT z, x, y, COUNT(*)::int AS parcel_centroids
    FROM tiles
    GROUP BY z, x, y
    ORDER BY parcel_centroids DESC
    LIMIT 1
  `);

  const { z, x, y, parcel_centroids } = sample.rows[0];
  console.log('Densest sample tile:', { z, x, y, parcel_centroids });

  const count = await client.query(
    `
    SELECT COUNT(*)::int AS n
    FROM land_parcels
    WHERE province_code = '79'
      AND geom IS NOT NULL
      AND geom && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)
    `,
    [z, x, y],
  );
  console.log('Parcels in tile:', count.rows[0].n);

  const { sql, params } = buildLandParcelsMvtQuery(z, x, y, 0.00001);
  const started = Date.now();
  const result = await client.query(sql, params);
  const tile = result.rows[0]?.tile;
  console.log('MVT bytes:', tile ? tile.length : 0, 'query ms:', Date.now() - started);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
