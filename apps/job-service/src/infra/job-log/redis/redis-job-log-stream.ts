import { JOB_LOG_STREAM_NAME } from '@job-queue/contracts';
import type { CloseClosableResponse } from '@job-queue/kernel';
import { IoRedisClient } from '@job-queue/service-kit';

import { JobLogStreamGroupMissingError } from '../../../domain/job-log/errors/job-log-stream-group-missing.error.js';
import type {
  AckJobLogStreamRequest,
  AckJobLogStreamResponse,
  JobLogStream,
  JobLogStreamRecord,
  LeaseJobLogStreamResponse,
  PrepareJobLogStreamResponse,
  ReadJobLogStreamRequest,
  ReadJobLogStreamResponse,
} from '../../../domain/job-log/job-log-stream.js';

export interface RedisJobLogStreamParams {
  redisUrl: string;
  /** Name of the connection in Redis `CLIENT LIST`. */
  connectionName: string;
  /** Identifies this job-service instance as the holder of the writer lease. */
  instanceId: string;
  /** How long the lease lasts without renewal. */
  leaseMs: number;
}

const GROUP = 'job-log-writer';
/** One consumer name for every instance: the lease allows one reader at a time, and the next holder continues with the entries the last one left unconfirmed. */
const CONSUMER = 'job-log-writer';
const LEASE_KEY = 'job-log-writer-lease';

/** Takes the lease when it is free, renews it when this instance holds it; 1 when held. */
const LEASE_SCRIPT = `
local holder = redis.call('GET', KEYS[1])
if holder == false then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
if holder == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0`;

type RawEntries = [id: string, fields: string[] | null][];
/** The reply for the one stream asked for: `[stream, entries]`, or null when the wait ran out. */
type RawReply = [stream: string, entries: RawEntries] | null;

/** The ioredis implementation of the job log stream: a consumer group with a writer lease. */
export class RedisJobLogStream implements JobLogStream {
  private readonly client: IoRedisClient;

  constructor(private readonly p: RedisJobLogStreamParams) {
    // maxRetriesPerRequest 1: with ioredis defaults a command waits for the connection through
    // many reconnect attempts (well over a minute), so an outage would hang the writer instead of
    // reaching it as a rejection. The offline queue stays on, as the first command opens the
    // lazy connection.
    this.client = new IoRedisClient({
      redisUrl: p.redisUrl,
      connectionName: p.connectionName,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // A Redis outage reaches the writer as rejected commands, which it retries.
      onError: () => undefined,
    });
  }

  async prepare(): Promise<PrepareJobLogStreamResponse> {
    try {
      await this.client.redis.xgroup('CREATE', JOB_LOG_STREAM_NAME, GROUP, '0', 'MKSTREAM');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('BUSYGROUP')) throw error;
    }
    return {};
  }

  async lease(): Promise<LeaseJobLogStreamResponse> {
    const held = await this.client.redis.eval(
      LEASE_SCRIPT,
      1,
      LEASE_KEY,
      this.p.instanceId,
      this.p.leaseMs,
    );
    return { held: held === 1 };
  }

  async read(req: ReadJobLogStreamRequest): Promise<ReadJobLogStreamResponse> {
    const block = !req.pending && req.blockMs > 0 ? ['BLOCK', req.blockMs] : [];
    const reply = (await this.client.redis
      .call(
        'XREADGROUP',
        'GROUP',
        GROUP,
        CONSUMER,
        'COUNT',
        req.count,
        ...block,
        'STREAMS',
        JOB_LOG_STREAM_NAME,
        req.pending ? '0' : '>',
      )
      .catch((error: unknown) => {
        throw this.isGroupMissing(error) ? new JobLogStreamGroupMissingError() : error;
      })) as RawReply;
    const entries = reply?.[1] ?? [];
    return { records: entries.map(([position, fields]) => this.toRecord({ position, fields })) };
  }

  async ack(req: AckJobLogStreamRequest): Promise<AckJobLogStreamResponse> {
    if (req.positions.length > 0) {
      await this.client.redis.xack(JOB_LOG_STREAM_NAME, GROUP, ...req.positions);
    }
    return {};
  }

  async close(): Promise<CloseClosableResponse> {
    return this.client.close();
  }

  /** The reply Redis gives for a stream or group that does not exist starts with `NOGROUP`. */
  private isGroupMissing(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith('NOGROUP');
  }

  /** An entry trimmed from the stream while pending has no fields: its body is empty. */
  private toRecord(req: { position: string; fields: string[] | null }): JobLogStreamRecord {
    const at = req.fields?.indexOf('data') ?? -1;
    return { position: req.position, body: (at >= 0 ? req.fields?.[at + 1] : undefined) ?? '' };
  }
}
