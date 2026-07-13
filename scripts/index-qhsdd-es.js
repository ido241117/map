const { Client } = require('@elastic/elasticsearch');
const { Client: PgClient } = require('pg');

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX = process.env.ELASTICSEARCH_QHSDD_INDEX || 'qhsdd';
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
        vn_search: {
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
      feature_id: { type: 'keyword' },
      loai_dat_quy_hoach: { type: 'text', analyzer: 'vn_search', fields: { keyword: { type: 'keyword' } } },
      district: { type: 'keyword' },
      ward: { type: 'keyword' },
      search_text: { type: 'text', analyzer: 'vn_search' },
      center_lat: { type: 'double' },
      center_long: { type: 'double' },
      location: { type: 'geo_point' },
    },
  },
};

const SOURCE_SQL = `
  SELECT
    id,
    feature_id,
    loai_dat_quy_hoach,
    district,
    ward,
    center_lat,
    center_long
  FROM hcm_qhsdd
  WHERE district IS NOT NULL
  ORDER BY id
`;

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

function toDoc(row) {
  const parts = [row.loai_dat_quy_hoach, row.ward, row.district].filter(Boolean);
  return {
    id: row.id,
    feature_id: row.feature_id || '',
    loai_dat_quy_hoach: row.loai_dat_quy_hoach || '',
    district: row.district || '',
    ward: row.ward || '',
    search_text: parts.join(' '),
    center_lat: row.center_lat,
    center_long: row.center_long,
    location: { lat: row.center_lat, lon: row.center_long },
  };
}

async function main() {
  const es = new Client({ node: ES_URL });
  const pg = new PgClient({ connectionString: DATABASE_URL });

  console.log(`Elasticsearch: ${ES_URL}`);
  console.log(`Index: ${INDEX}`);
  await waitForElasticsearch(es);

  const exists = await es.indices.exists({ index: INDEX });
  if (exists) {
    await es.indices.delete({ index: INDEX });
  }
  await es.indices.create({ index: INDEX, ...INDEX_BODY });

  await pg.connect();
  await pg.query('BEGIN');
  await pg.query(`DECLARE es_qhsdd_cursor CURSOR FOR ${SOURCE_SQL}`);

  let total = 0;
  while (true) {
    const { rows } = await pg.query(`FETCH ${BATCH_SIZE} FROM es_qhsdd_cursor`);
    if (!rows.length) break;

    const body = [];
    for (const row of rows) {
      body.push({ index: { _index: INDEX, _id: String(row.id) } });
      body.push(toDoc(row));
    }

    const bulkResponse = await es.bulk({ refresh: false, operations: body });
    if (bulkResponse.errors) {
      const firstError = bulkResponse.items.find((item) => item.index?.error);
      throw new Error(`Bulk index lỗi: ${JSON.stringify(firstError?.index?.error)}`);
    }

    total += rows.length;
    process.stdout.write(`\rqhsdd: ${total.toLocaleString('vi-VN')} dòng`);
  }

  await pg.query('CLOSE es_qhsdd_cursor');
  await pg.query('COMMIT');
  await pg.end();
  process.stdout.write('\n');

  await es.indices.refresh({ index: INDEX });
  const stats = await es.count({ index: INDEX });
  console.log(`Hoàn tất index ${stats.count.toLocaleString('vi-VN')} documents`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
