import type { ClickHouseClient } from '@clickhouse/client';

import { LogStoreUnavailableError } from '../../../domain/job-log/errors/log-store-unavailable.error.js';
import type {
  ApplyJobLogSchemaResponse,
  JobLogSchema,
} from '../../../domain/job-log/job-log-schema.js';

export interface ClickHouseJobLogSchemaDeps {
  client: ClickHouseClient;
}

export interface ClickHouseJobLogSchemaParams {
  /** How long entries are kept; the table's `TTL` is set to it on every apply. */
  retentionDays: number;
}

/** Creates the `job_log` table and sets its retention (design §5). */
export class ClickHouseJobLogSchema implements JobLogSchema {
  constructor(
    private readonly d: ClickHouseJobLogSchemaDeps,
    private readonly p: ClickHouseJobLogSchemaParams,
  ) {}

  async apply(): Promise<ApplyJobLogSchemaResponse> {
    const ttl = `toDateTime(ts) + INTERVAL ${this.p.retentionDays} DAY`;
    try {
      await this.d.client.command({
        query: `
          CREATE TABLE IF NOT EXISTS job_log (
            id          UUID,
            job_id      UUID,
            seq_ms      UInt64,
            seq_n       UInt32,
            ts          DateTime64(3, 'UTC'),
            attempt     Nullable(UInt32),
            level       Enum8('info' = 1, 'warning' = 2, 'error' = 3),
            message     String,
            metadata    String,
            source      LowCardinality(String),
            instance_id Nullable(String)
          )
          ENGINE = ReplacingMergeTree
          ORDER BY (job_id, seq_ms, seq_n, id)
          TTL ${ttl}`,
      });
      await this.d.client.command({ query: `ALTER TABLE job_log MODIFY TTL ${ttl}` });
    } catch {
      throw new LogStoreUnavailableError({ operation: 'schema' });
    }
    return {};
  }
}
