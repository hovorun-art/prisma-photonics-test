import { fileURLToPath } from 'node:url';

import {
  CONTAINER_IMAGES,
  PgStatActivityConnectionCounter,
  PrismaMigrateDeploy,
} from '@job-queue/test-support';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_APPLICATION_NAME, PrismaDatabase } from './prisma-database.js';

const APP_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const SCHEMA = 'job_groups';
const POLL = { timeout: 10_000, interval: 100 };

describe('PrismaDatabase against Postgres', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(CONTAINER_IMAGES.postgres).start();
    await new PrismaMigrateDeploy({ appDir: APP_DIR }).migrate({
      databaseUrl: `${container.getConnectionUri()}?schema=${SCHEMA}`,
    });
  }, 180_000);
  afterAll(async () => {
    await container.stop();
  });

  async function openConnections(): Promise<number> {
    const { connections } = await new PgStatActivityConnectionCounter({
      postgres: container,
    }).count({ name: DATABASE_APPLICATION_NAME });
    return connections;
  }

  it('connects under its application name, answers a simple query and disconnects', async () => {
    const database = new PrismaDatabase({
      databaseUrl: container.getConnectionUri(),
      databaseSchema: SCHEMA,
    });

    await expect(database.ping()).resolves.toEqual({});
    expect(await openConnections()).toBeGreaterThan(0);

    await database.close();

    await expect.poll(openConnections, POLL).toBe(0);
  });

  it('reads and writes the groups in its own schema, not in public', async () => {
    const database = new PrismaDatabase({
      databaseUrl: container.getConnectionUri(),
      databaseSchema: SCHEMA,
    });

    try {
      await database.jobGroup.create({
        data: { status: 'running', total: 0, completed: 0, failed: 0 },
      });
      const tables = await database.$queryRaw<{ table_schema: string }[]>`
        SELECT table_schema FROM information_schema.tables WHERE table_name = 'job_groups'`;

      expect(await database.jobGroup.count()).toBe(1);
      expect(tables).toEqual([{ table_schema: SCHEMA }]);
    } finally {
      await database.close();
    }
  });
});
