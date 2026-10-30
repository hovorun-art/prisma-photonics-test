import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  JobLogCursor,
  JobLogEntry,
  JobLogStreamMessage,
  QueryJobLogRequest,
  QueryJobLogResponse,
} from './job-log.js';

const ENTRY_ID = randomUUID();
const JOB_ID = randomUUID();

const fullEntry = {
  id: ENTRY_ID,
  jobId: JOB_ID,
  attempt: 2,
  level: 'warning',
  message: 'job-service unavailable, retrying',
  metadata: { retry: 1, status: 'failed' },
  timestamp: '2026-10-30T12:00:00.123Z',
  source: 'job-execution-service',
  instanceId: 'worker-1',
};

const streamMessage = {
  id: ENTRY_ID,
  jobId: JOB_ID,
  attempt: 1,
  level: 'info',
  message: 'Attempt picked up',
  metadata: {},
  ts: 1_793_000_000_123,
  source: 'job-execution-service',
  instanceId: 'worker-1',
};

describe('JobLogEntry', () => {
  const issuePaths = (input: unknown): PropertyKey[][] =>
    JobLogEntry.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

  it('Entry fields: accepts a full entry', () => {
    expect(JobLogEntry.parse(fullEntry)).toEqual(fullEntry);
  });

  it('accepts an entry without attempt and instance id', () => {
    const submitted = {
      ...fullEntry,
      attempt: null,
      instanceId: null,
      level: 'info',
      source: 'job-service',
    };

    expect(JobLogEntry.parse(submitted)).toEqual(submitted);
  });

  it.each(['yesterday', '2026-10-30T12:00:00Z', '2026-10-30T12:00:00.1Z'])(
    'rejects a timestamp without milliseconds or not ISO: %s',
    (timestamp) => {
      expect(issuePaths({ ...fullEntry, timestamp })).toEqual([['timestamp']]);
    },
  );

  it.each(['attempt', 'instanceId'])('rejects an entry with %s left out instead of null', (key) => {
    const { [key as keyof typeof fullEntry]: _left, ...rest } = fullEntry;

    expect(issuePaths(rest)).toEqual([[key]]);
  });
});

describe('JobLogStreamMessage', () => {
  const issuePaths = (input: unknown): PropertyKey[][] =>
    JobLogStreamMessage.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

  it('accepts a message of a worker step', () => {
    expect(JobLogStreamMessage.parse(streamMessage)).toEqual(streamMessage);
  });

  it('accepts the lowest time and attempt', () => {
    const lowest = { ...streamMessage, ts: 0, attempt: 1 };

    expect(JobLogStreamMessage.parse(lowest)).toEqual(lowest);
  });

  it('accepts a message without attempt and instance id', () => {
    const { attempt: _attempt, instanceId: _instanceId, ...submitted } = streamMessage;

    expect(JobLogStreamMessage.parse({ ...submitted, source: 'job-service' })).toEqual({
      ...submitted,
      source: 'job-service',
    });
  });

  it.each([
    { path: ['level'], message: { ...streamMessage, level: 'debug' } },
    { path: ['id'], message: { ...streamMessage, id: 'not-a-uuid' } },
    { path: ['jobId'], message: { ...streamMessage, jobId: 'not-a-uuid' } },
    { path: ['attempt'], message: { ...streamMessage, attempt: -1 } },
    { path: ['attempt'], message: { ...streamMessage, attempt: 0 } },
    { path: ['source'], message: { ...streamMessage, source: 'job-ui' } },
    { path: ['ts'], message: { ...streamMessage, ts: -5 } },
    { path: ['ts'], message: { ...streamMessage, ts: 1.5 } },
    { path: ['attempt'], message: { ...streamMessage, attempt: 1.5 } },
    { path: ['instanceId'], message: { ...streamMessage, instanceId: '' } },
    { path: ['metadata'], message: { ...streamMessage, metadata: 'x' } },
    { path: ['metadata'], message: { ...streamMessage, metadata: [1] } },
    { path: ['message'], message: { ...streamMessage, message: undefined } },
    { path: ['message'], message: { ...streamMessage, message: 42 } },
  ])('rejects an invalid $path', ({ path, message }) => {
    expect(issuePaths(message)).toEqual([path]);
  });
});

describe('JobLogCursor', () => {
  it('round-trips a stream id', () => {
    const cursor = JobLogCursor.encode('1793000000123-7');

    expect(JobLogCursor.decode(cursor)).toBe('1793000000123-7');
  });

  // Lengths that need no, two and one padding characters in standard base64.
  it.each(['1793000000123-7', '1793000000123-12', '1793000000123-123'])(
    'encodes %s as its base64url form and decodes it back',
    (position) => {
      const reference = Buffer.from(position).toString('base64url');

      expect(JobLogCursor.encode(position)).toBe(reference);
      expect(JobLogCursor.decode(reference)).toBe(position);
    },
  );

  it('does not issue a cursor for a value that is not a log position', () => {
    expect(JobLogCursor.safeEncode('abc').success).toBe(false);
  });

  it('issues an opaque cursor, not the stream id itself', () => {
    expect(JobLogCursor.encode('1793000000123-7')).not.toContain('-7');
  });

  it.each(['1793000000123-7', 'not a cursor!', '', btoa('hello'), 'abcde', '____'])(
    'Malformed cursor: rejects %j',
    (value) => {
      expect(JobLogCursor.safeDecode(value).success).toBe(false);
    },
  );
});

describe('QueryJobLogRequest', () => {
  const issuePaths = (input: unknown): PropertyKey[][] =>
    QueryJobLogRequest.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];
  const cursor = JobLogCursor.encode('1793000000123-0');

  it('accepts no parameters', () => {
    expect(QueryJobLogRequest.parse({})).toEqual({});
  });

  it('accepts one level, a limit and a cursor', () => {
    expect(QueryJobLogRequest.parse({ level: 'error', limit: '50', after: cursor })).toEqual({
      level: ['error'],
      limit: 50,
      after: '1793000000123-0',
    });
  });

  it('Two levels: accepts warning and error', () => {
    expect(QueryJobLogRequest.parse({ level: ['warning', 'error'] })).toEqual({
      level: ['warning', 'error'],
    });
  });

  it('accepts the lowest limit', () => {
    expect(QueryJobLogRequest.parse({ limit: '1' })).toEqual({ limit: 1 });
  });

  it.each([
    { path: ['level', 0], query: { level: 'debug' } },
    { path: ['level', 0], query: { level: '' } },
    { path: ['level'], query: { level: [] } },
    { path: ['limit'], query: { limit: 'abc' } },
    { path: ['limit'], query: { limit: '0' } },
    { path: ['limit'], query: { limit: '-3' } },
    { path: ['limit'], query: { limit: '2.5' } },
    { path: ['after'], query: { after: 'not a cursor!' } },
  ])('Unknown level, bad limit or malformed cursor: rejects $query', ({ path, query }) => {
    expect(issuePaths(query)).toEqual([path]);
  });
});

describe('QueryJobLogResponse', () => {
  it('accepts entries with a cursor', () => {
    const page = { items: [fullEntry], nextCursor: JobLogCursor.encode('1-0') };

    expect(QueryJobLogResponse.parse(page)).toEqual(page);
  });

  it('accepts no entries and a null cursor', () => {
    expect(QueryJobLogResponse.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
