/**
 * Import HCM metro plan (lines) into osm_railways as railway='metro_plan'.
 * Also regenerates frontend GeoJSON for stations + TOD (no DB point/polygon schema).
 *
 * Usage:
 *   npm run db:osm:highways:up
 *   npm run db:osm:highways:import-metro-plan
 *
 * Requires local `_metro_plan.json` (not committed). Does not alter table schema.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, '_metro_plan.json');
const FRONTEND_OUT = path.join(ROOT, 'frontend', 'src', 'constants', 'metroPlan.ts');
const OSM_ID_BASE = -9_000_000;
const RAILWAY_TAG = 'metro_plan';

/** L1 subway + L2 construction already drawn — skip plan duplicates. */
const SKIP_LINE_REFS = new Set(['1', '2']);

function isSkippedDuplicate(name, route) {
  const ref = shortRef(name);
  if (SKIP_LINE_REFS.has(ref)) return true;
  const blob = `${name} ${route}`.toLowerCase();
  if (/bến thành/.test(blob) && /suối tiên/.test(blob)) return true;
  if (/bến thành/.test(blob) && /tham lương/.test(blob)) return true;
  return false;
}

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function ringTo2d(coords) {
  return coords.map((c) => [Number(c[0]), Number(c[1])]);
}

function lineStringValid(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return false;
  return coords.every(
    (c) => Number.isFinite(c[0]) && Number.isFinite(c[1]),
  );
}

function shortRef(tenTuyen) {
  const s = String(tenTuyen || '').trim();
  if (/Monorail số\s*(\d+)/i.test(s)) return `MR${RegExp.$1}`;
  if (/xe điện/i.test(s)) return 'TRAM1';
  if (/số\s*(\d+[A-Z]?)/i.test(s)) return RegExp.$1;
  return s.slice(0, 12) || 'plan';
}

function loadPlanData() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`Missing ${DATA_PATH} (local metro plan GeoJSON dump).`);
  }
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  if (!raw?.data?.lines?.features) {
    throw new Error('Unexpected JSON shape (expected data.lines.features).');
  }
  return raw.data;
}

function explodeLines(features) {
  /** @type {{ osmId: number, name: string, ref: string, color: string, route: string, geojson: object }[]} */
  const rows = [];
  let seq = 0;
  let skippedLines = 0;
  for (const feature of features) {
    const props = feature.properties || {};
    const name = String(props.TenTuyen || props.name || 'Quy hoạch metro').trim();
    const color = String(props.color || '#64748b').trim() || '#64748b';
    const route = String(props.LoTrinh || '').trim();
    const ref = shortRef(name);
    if (isSkippedDuplicate(name, route)) {
      skippedLines += 1;
      console.log(`Skip duplicate line: ${name} (${route || ref})`);
      continue;
    }
    const geom = feature.geometry;
    if (!geom) continue;

    /** @type {number[][][]} */
    let parts = [];
    if (geom.type === 'LineString') {
      parts = [ringTo2d(geom.coordinates)];
    } else if (geom.type === 'MultiLineString') {
      parts = geom.coordinates.map(ringTo2d);
    } else {
      console.warn(`Skip non-line geometry: ${geom.type} (${name})`);
      continue;
    }

    for (const coords of parts) {
      if (!lineStringValid(coords)) continue;
      seq += 1;
      rows.push({
        osmId: OSM_ID_BASE - seq,
        name,
        ref,
        color,
        route,
        geojson: { type: 'LineString', coordinates: coords },
      });
    }
  }
  if (skippedLines) {
    console.log(`Skipped ${skippedLines} line feature(s) already covered elsewhere.`);
  }
  return rows;
}

function stationsGeoJson(pointsFc) {
  let skippedStations = 0;
  const features = (pointsFc?.features || [])
    .map((f) => {
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) return null;
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      const p = f.properties || {};
      const line = String(p.TenTuyen || '').trim();
      const route = String(p.LoTrinh || '').trim();
      // Drop L1 — hardcoded L1 stations already cover Bến Thành–Suối Tiên.
      if (shortRef(line) === '1' || (/bến thành/i.test(route) && /suối tiên/i.test(route))) {
        skippedStations += 1;
        return null;
      }
      return {
        type: 'Feature',
        properties: {
          fid: p.fid != null ? String(p.fid) : null,
          name: String(p.name || 'Nhà ga').trim(),
          description: String(p.description || '').trim(),
          color: String(p.color || '#64748b').trim() || '#64748b',
          line,
          route,
        },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      };
    })
    .filter(Boolean);
  if (skippedStations) {
    console.log(`Skipped ${skippedStations} L1 stations (use hardcoded L1).`);
  }
  return { type: 'FeatureCollection', features };
}

function todGeoJson(todFc) {
  const features = (todFc?.features || [])
    .map((f) => {
      if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) {
        return null;
      }
      const p = f.properties || {};
      return {
        type: 'Feature',
        properties: {
          id: p.id != null ? String(p.id) : null,
          name: String(p.name || 'TOD').trim(),
          description: String(p.description || '').trim(),
        },
        geometry: f.geometry,
      };
    })
    .filter(Boolean);
  return { type: 'FeatureCollection', features };
}

function writeFrontendConstants(stations, tod) {
  const body = `/** Auto-generated by scripts/import-metro-plan.js — do not edit by hand. */

export function metroPlanStationsGeoJson(): GeoJSON.FeatureCollection {
  return ${JSON.stringify(stations, null, 2)} as GeoJSON.FeatureCollection;
}

export function metroPlanTodGeoJson(): GeoJSON.FeatureCollection {
  return ${JSON.stringify(tod, null, 2)} as GeoJSON.FeatureCollection;
}
`;
  fs.mkdirSync(path.dirname(FRONTEND_OUT), { recursive: true });
  fs.writeFileSync(FRONTEND_OUT, body, 'utf8');
}

async function importLines(client, rows) {
  await client.query(`DELETE FROM osm_railways WHERE railway = $1 OR osm_id <= $2`, [
    RAILWAY_TAG,
    OSM_ID_BASE,
  ]);

  let inserted = 0;
  for (const row of rows) {
    await client.query(
      `INSERT INTO osm_railways (osm_id, name, railway, ref, z_order, bridge, tunnel, layer, service, way)
       VALUES (
         $1, $2, $3, $4, 0, NULL, NULL, $5, $6,
         ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)
       )`,
      [row.osmId, row.name, RAILWAY_TAG, row.ref, row.route || null, row.color, JSON.stringify(row.geojson)],
    );
    inserted += 1;
  }
  return inserted;
}

async function main() {
  loadEnvFile();
  const data = loadPlanData();
  const lineRows = explodeLines(data.lines.features);
  const stations = stationsGeoJson(data.points);
  const tod = todGeoJson(data.tod);

  console.log(
    `Plan: ${data.lines.features.length} line features → ${lineRows.length} LineStrings; ` +
      `${stations.features.length} stations; ${tod.features.length} TOD polygons`,
  );

  writeFrontendConstants(stations, tod);
  console.log(`Wrote ${path.relative(ROOT, FRONTEND_OUT)}`);

  const connectionString =
    process.env.OSM_DATABASE_URL || 'postgres://postgres:postgres@localhost:5435/osm_highways';
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const inserted = await importLines(client, lineRows);
    const { rows: counts } = await client.query(
      `SELECT railway, count(*)::int AS n FROM osm_railways GROUP BY 1 ORDER BY n DESC`,
    );
    console.log(`Inserted metro_plan rows: ${inserted}`);
    console.log('osm_railways by railway:');
    for (const r of counts) console.log(`  ${r.railway}: ${r.n}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
