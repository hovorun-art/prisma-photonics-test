import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { CONTAINER_IMAGES, PgStatActivityConnectionCounter } from '@job-queue/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_APPLICATION_NAME, PrismaDatabase } from './prisma-database.js';

const POLL = { timeout: 10_000, interval: 100 };

describe('PrismaDatabase against Postgres', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(CONTAINER_IMAGES.postgres).start();
  });
  afterAll(async () => {
    await container.stop();
  });

  async function openConnections(): Promise<number> {
    const { connections } = await new PgStatActivityConnectionCounter({
      postgres: container,
    }).count({ name: DATABASE_APPLICATION_NAME });
    return connections;
  }

  it('connects, answers a simple query and disconnects', async () => {
    const database = new PrismaDatabase({ databaseUrl: container.getConnectionUri() });

    await expect(database.ping()).resolves.toEqual({});
    expect(await openConnections()).toBeGreaterThan(0);

    await database.close();

    await expect.poll(openConnections, POLL).toBe(0);
  });
});
