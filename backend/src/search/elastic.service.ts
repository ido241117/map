import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client, type ClientOptions } from '@elastic/elasticsearch';

@Injectable()
export class ElasticService implements OnModuleDestroy {
  private readonly logger = new Logger(ElasticService.name);
  private client: Client | null = null;
  private ready = false;
  private checkedAt = 0;

  private getClient() {
    if (!this.client) {
      const node = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
      const options: ClientOptions = { node };
      if (process.env.ELASTICSEARCH_API_KEY) {
        options.auth = { apiKey: process.env.ELASTICSEARCH_API_KEY };
      } else if (process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD) {
        options.auth = {
          username: process.env.ELASTICSEARCH_USERNAME,
          password: process.env.ELASTICSEARCH_PASSWORD,
        };
      }
      this.client = new Client(options);
    }
    return this.client;
  }

  get indexName() {
    return process.env.ELASTICSEARCH_PARCELS_INDEX || 'parcels';
  }

  async isAvailable(force = false) {
    const now = Date.now();
    if (!force && now - this.checkedAt < 30_000) return this.ready;

    try {
      const client = this.getClient();
      const health = await client.cluster.health({ timeout: '2s' });
      this.ready = health.status !== 'red';
      this.checkedAt = now;
      return this.ready;
    } catch (error) {
      this.ready = false;
      this.checkedAt = now;
      this.logger.warn(
        `Elasticsearch unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async search<T = Record<string, unknown>>(body: Record<string, unknown>) {
    const client = this.getClient();
    const result = await client.search<T>({
      index: this.indexName,
      ...body,
    });
    return result;
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
