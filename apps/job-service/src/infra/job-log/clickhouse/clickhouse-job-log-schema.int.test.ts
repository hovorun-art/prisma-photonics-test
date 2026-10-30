import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { CONTAINER_IMAGES, UNREACHABLE_HTTP_URL } from '@job-queue/test-support';
import { ClickHouseContainer, type StartedClickHouseContainer } from '@testcontainers/clickhouse';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ClickHouseJobLogSchema } from './clickhouse-job-log-schema.js';

describe('ClickHouseJobLogSchema against ClickHouse', () => {
  let container: StartedClickHouseContainer;
  let client: ClickHouseClient;

  const showCreateTable = async (): Promise<string> => {
    const result = await client.query({
      query: 'SHOW CREATE TABLE job_log',
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ statement: string }>();
    return rows[0]?.statement ?? '';
  };

  beforeAll(async () => {
    container = await new ClickHouseContainer(CONTAINER_IMAGES.clickhouse).start();
    client = createClient({ url: container.getConnectionUrl() });
  });
  afterAll(async () => {
    await client.close();
    await container.stop();
  });

  it('creates the table with the configured retention', async () => {
    await expect(
      new ClickHouseJobLogSchema({ client }, { retentionDays: 7 }).apply(),
    ).resolves.toEqual({});

    expect(await showCreateTable()).toContain('toIntervalDay(7)');
  });

  it('applies again without error and moves the retention to the new configured value', async () => {
    await new ClickHouseJobLogSchema({ client }, { retentionDays: 7 }).apply();

    await expect(
      new ClickHouseJobLogSchema({ client }, { retentionDays: 14 }).apply(),
    ).resolves.toEqual({});

    expect(await showCreateTable()).toContain('toIntervalDay(14)');
  });

  it('reports an unreachable store as unavailable', async () => {
    const unreachable = createClient({ url: UNREACHABLE_HTTP_URL });

    await expect(
      new ClickHouseJobLogSchema({ client: unreachable }, { retentionDays: 7 }).apply(),
    ).rejects.toMatchObject({
      code: 'LOG_STORE_UNAVAILABLE',
      details: { operation: 'schema' },
    });

    await unreachable.close();
  });
});
