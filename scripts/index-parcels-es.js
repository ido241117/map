const { Client } = require('@elastic/elasticsearch');
const { Client: PgClient } = require('pg');
const { buildParcelSearchDoc } = require('../lib/address-normalize');

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX = process.env.ELASTICSEARCH_PARCELS_INDEX || 'parcels';
const BATCH_SIZE = Number(process.env.ES_BATCH_SIZE || 2000);
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@localhost:5433/hcm_land_mvp';

const INDEX_BODY = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      filter: {
        vn_ascii: {
          type: 'asciifolding',
          preserve_original: true,
        },
      },
      analyzer: {
        vn_address: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'vn_ascii'],
        },
      },
    },
  },
  mappings: {
    properties: {
      id: { type: 'integer' },
      source: { type: 'keyword' },
      property_code: { type: 'keyword' },
      address: { type: 'text', analyzer: 'vn_address' },
      street_line: { type: 'text', analyzer: 'vn_address' },
      full_address: { type: 'text', analyzer: 'vn_address' },
      search_text: { type: 'text', analyzer: 'vn_address' },
      ward: { type: 'keyword' },
      district: { type: 'keyword' },
      province: { type: 'keyword' },
      ward_norm: { type: 'keyword' },
      district_norm: { type: 'keyword' },
      province_norm: { type: 'keyword' },
      latitude: { type: 'double' },
      longitude: { type: 'double' },
      location: { type: 'geo_point' },
    },
  },
};

const SOURCES = [
  {
    source: 'land_parcels',
    sql: `
      SELECT
        id,
        property_code,
        address,
        ward,
        district,
        province,
        latitude,
        longitude
      FROM land_parcels
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY id
    `,
  },
];

async function waitForElasticsearch(client, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const health = await client.cluster.health({ timeout: '2s' });
      if (health.status !== 'red') return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Elasticsearch chưa sẵn sàng tại ${ES_URL}`);
}

async function recreateIndex(client) {
  const exists = await client.indices.exists({ index: INDEX });
  if (exists) {
    await client.indices.delete({ index: INDEX });
  }
  await client.indices.create({ index: INDEX, ...INDEX_BODY });
}

function normalizeGeoPoint(latitude, longitude) {
  let lat = Number(latitude);
  let lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  if (lat >= 102 && lat <= 110 && lng >= 8 && lng <= 24) {
    [lat, lng] = [lng, lat];
  }

  if (lat < 8 || lat > 24 || lng < 102 || lng > 110 || Math.abs(lat - lng) < 0.0001) {
    return null;
  }

  return { lat, lon: lng };
}

function toBulkLines(source, rows) {
  const lines = [];
  for (const row of rows) {
    const normalized = buildParcelSearchDoc({
      address: row.address,
      ward: row.ward,
      district: row.district,
      province: row.province,
      property_code: row.property_code,
    });

    const geo = normalizeGeoPoint(row.latitude, row.longitude);
    const doc = {
      id: row.id,
      source,
      property_code: row.property_code || '',
      latitude: geo?.lat ?? row.latitude,
      longitude: geo?.lon ?? row.longitude,
      ...normalized,
    };
    if (geo) {
      doc.location = geo;
    }

    lines.push({ index: { _index: INDEX, _id: `${source}:${row.id}` } });
    lines.push(doc);
  }
  return lines;
}

async function indexSource(pg, es, sourceConfig) {
  const cursorName = `es_cursor_${sourceConfig.source}`;
  await pg.query('BEGIN');
  await pg.query(`DECLARE ${cursorName} CURSOR FOR ${sourceConfig.sql}`);

  let total = 0;
  while (true) {
    const { rows } = await pg.query(`FETCH ${BATCH_SIZE} FROM ${cursorName}`);
    if (!rows.length) break;

    const body = toBulkLines(sourceConfig.source, rows);
    const bulkResponse = await es.bulk({ refresh: false, operations: body });
    if (bulkResponse.errors) {
      const firstError = bulkResponse.items.find((item) => item.index?.error);
      throw new Error(
        `Bulk index lỗi (${sourceConfig.source}): ${JSON.stringify(firstError?.index?.error)}`,
      );
    }

    total += rows.length;
    process.stdout.write(`\r${sourceConfig.source}: ${total.toLocaleString('vi-VN')} dòng`);
  }

  await pg.query('CLOSE ' + cursorName);
  await pg.query('COMMIT');
  process.stdout.write('\n');
  return total;
}

async function main() {
  const es = new Client({ node: ES_URL });
  const pg = new PgClient({ connectionString: DATABASE_URL });

  console.log(`Elasticsearch: ${ES_URL}`);
  console.log(`Index: ${INDEX}`);
  await waitForElasticsearch(es);
  await recreateIndex(es);

  await pg.connect();
  let grandTotal = 0;
  for (const sourceConfig of SOURCES) {
    const count = await indexSource(pg, es, sourceConfig);
    grandTotal += count;
    console.log(`  -> ${sourceConfig.source}: ${count.toLocaleString('vi-VN')} dòng`);
  }

  await es.indices.refresh({ index: INDEX });
  await pg.end();

  const stats = await es.count({ index: INDEX });
  console.log(`Hoàn tất index ${stats.count.toLocaleString('vi-VN')} / ${grandTotal.toLocaleString('vi-VN')} documents`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
