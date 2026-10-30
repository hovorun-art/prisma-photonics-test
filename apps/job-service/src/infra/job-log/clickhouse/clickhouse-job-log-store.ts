import type { ClickHouseClient } from '@clickhouse/client';
import { JobLogStreamMessage } from '@job-queue/contracts';
import type { CloseClosableResponse } from '@job-queue/kernel';

import { LogStoreUnavailableError } from '../../../domain/job-log/errors/log-store-unavailable.error.js';
import type {
  InsertJobLogStoreRequest,
  InsertJobLogStoreResponse,
  JobLogStore,
  PositionedJobLogEntry,
  QueryJobLogStoreRequest,
  QueryJobLogStoreResponse,
} from '../../../domain/job-log/job-log-store.js';

export interface ClickHouseJobLogStoreDeps {
  client: ClickHouseClient;
}

/** A row of `job_log` as ClickHouse returns it in JSON (64-bit integers come as strings). */
interface JobLogRow {
  id: string;
  job_id: string;
  seq_ms: string;
  seq_n: number;
  ts_ms: string;
  attempt: number | null;
  level: JobLogStreamMessage['level'];
  message: string;
  metadata: string;
  source: JobLogStreamMessage['source'];
  instance_id: string | null;
}

/** ClickHouse `ReplacingMergeTree` implementation of the job log store (design §5). */
export class ClickHouseJobLogStore implements JobLogStore {
  constructor(private readonly d: ClickHouseJobLogStoreDeps) {}

  async insert(req: InsertJobLogStoreRequest): Promise<InsertJobLogStoreResponse> {
    if (req.entries.length === 0) return {};
    try {
      await this.d.client.insert({
        table: 'job_log',
        format: 'JSONEachRow',
        values: req.entries.map((positioned) => this.toRow(positioned)),
      });
    } catch {
      throw new LogStoreUnavailableError({ operation: 'insert' });
    }
    return {};
  }

  async query(req: QueryJobLogStoreRequest): Promise<QueryJobLogStoreResponse> {
    const [afterMs, afterN] = this.splitPosition(req.after ?? '0-0');
    const levelFilter =
      req.levels === undefined ? '' : 'AND has({levels:Array(String)}, toString(level))';
    try {
      const result = await this.d.client.query({
        query: `
          SELECT id, job_id, seq_ms, seq_n, toUnixTimestamp64Milli(ts) AS ts_ms, attempt, level,
                 message, metadata, source, instance_id
          FROM job_log FINAL
          WHERE job_id = {jobId:UUID}
            AND (seq_ms, seq_n) > ({afterMs:UInt64}, {afterN:UInt32})
            ${levelFilter}
          ORDER BY seq_ms, seq_n, id
          LIMIT {limit:UInt32}`,
        query_params: {
          jobId: req.jobId,
          afterMs,
          afterN,
          limit: req.limit,
          ...(req.levels === undefined ? {} : { levels: req.levels }),
        },
        format: 'JSONEachRow',
      });
      const rows = await result.json<JobLogRow>();
      return { entries: rows.map((row) => this.fromRow(row)) };
    } catch {
      throw new LogStoreUnavailableError({ operation: 'query' });
    }
  }

  async close(): Promise<CloseClosableResponse> {
    await this.d.client.close();
    return {};
  }

  private toRow(positioned: PositionedJobLogEntry): Record<string, unknown> {
    const { entry } = positioned;
    const [seqMs, seqN] = this.splitPosition(positioned.position);
    return {
      id: entry.id,
      job_id: entry.jobId,
      seq_ms: seqMs,
      seq_n: seqN,
      ts: new Date(entry.ts).toISOString().replace('T', ' ').replace('Z', ''),
      attempt: entry.attempt ?? null,
      level: entry.level,
      message: entry.message,
      metadata: JSON.stringify(entry.metadata),
      source: entry.source,
      instance_id: entry.instanceId ?? null,
    };
  }

  private fromRow(row: JobLogRow): PositionedJobLogEntry {
    return {
      position: `${row.seq_ms}-${row.seq_n}`,
      entry: {
        id: row.id,
        jobId: row.job_id,
        ...(row.attempt === null ? {} : { attempt: row.attempt }),
        level: row.level,
        message: row.message,
        metadata: JSON.parse(row.metadata) as JobLogStreamMessage['metadata'],
        ts: Number(row.ts_ms),
        source: row.source,
        ...(row.instance_id === null ? {} : { instanceId: row.instance_id }),
      },
    };
  }

  /** `<ms>-<seq>` into its two numbers (the position is a validated stream id). */
  private splitPosition(position: string): [string, string] {
    const [ms = '0', seq = '0'] = position.split('-');
    return [ms, seq];
  }
}
