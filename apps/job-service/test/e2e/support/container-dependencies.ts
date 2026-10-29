import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

import {
  ClientListRedisConnectionCounter,
  CONTAINER_IMAGES,
  PgStatActivityConnectionCounter,
  PrismaMigrateDeploy,
  type PostgresConnectionCounter,
  type RedisConnectionCounter,
} from '@job-queue/test-support';

import type {
  Dependencies,
  OpenConnectionsDependenciesRequest,
  OpenConnectionsDependenciesResponse,
  StopDependenciesResponse,
} from './dependencies.js';

export interface ContainerDependenciesDeps {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
}

export interface StartContainerDependenciesResponse {
  dependencies: ContainerDependencies;
}

/** job-service's directory, which holds its Prisma config and migrations. */
const JOB_SERVICE_DIR = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Postgres (migrated to the latest schema) and Redis in Testcontainers, plus a Redis client that
 * observes the connections.
 */
export class ContainerDependencies implements Dependencies {
  private readonly postgresConnections: PostgresConnectionCounter;
  private readonly redisConnections: RedisConnectionCounter;

  constructor(private readonly d: ContainerDependenciesDeps) {
    this.postgresConnections = new PgStatActivityConnectionCounter({ postgres: d.postgres });
    this.redisConnections = new ClientListRedisConnectionCounter({
      redisUrl: d.redis.getConnectionUrl(),
    });
  }

  static async start(): Promise<StartContainerDependenciesResponse> {
    const [postgres, redis] = await Promise.all([
      new PostgreSqlContainer(CONTAINER_IMAGES.postgres).start(),
      new RedisContainer(CONTAINER_IMAGES.redis).start(),
    ]);
    await new PrismaMigrateDeploy({ appDir: JOB_SERVICE_DIR }).migrate({
      databaseUrl: postgres.getConnectionUri(),
    });
    return { dependencies: new ContainerDependencies({ postgres, redis }) };
  }

  get databaseUrl(): string {
    return this.d.postgres.getConnectionUri();
  }

  get redisUrl(): string {
    return this.d.redis.getConnectionUrl();
  }

  async openConnections(
    req: OpenConnectionsDependenciesRequest,
  ): Promise<OpenConnectionsDependenciesResponse> {
    const database = await this.postgresConnections.count({ name: req.name });
    const redis = await this.redisConnections.count({ name: req.name });
    return {
      database: database.connections,
      redis: redis.connections,
    };
  }

  async stop(): Promise<StopDependenciesResponse> {
    await this.redisConnections.close();
    await Promise.all([this.d.postgres.stop(), this.d.redis.stop()]);
    return {};
  }
}
