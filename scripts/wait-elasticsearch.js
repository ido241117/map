const { Client } = require('@elastic/elasticsearch');

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const MAX_ATTEMPTS = Number(process.env.ES_WAIT_ATTEMPTS || 60);

async function main() {
  const client = new Client({ node: ES_URL });
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const health = await client.cluster.health({ timeout: '2s' });
      if (health.status !== 'red') {
        console.log(`Elasticsearch ready (${health.status}) at ${ES_URL}`);
        return;
      }
    } catch {
      // retry
    }
    process.stdout.write(`\rĐợi Elasticsearch... (${attempt}/${MAX_ATTEMPTS})`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Elasticsearch chưa sẵn sàng tại ${ES_URL}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
