export { UNREACHABLE_DATABASE_URL, UNREACHABLE_REDIS_URL } from '@job-queue/test-support';

/** The infrastructure job-service runs against, started fresh for each e2e file. */
export interface Dependencies {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** Connections a client opened under `name` (`application_name`, `CLIENT SETNAME`). */
  openConnections(
    req: OpenConnectionsDependenciesRequest,
  ): Promise<OpenConnectionsDependenciesResponse>;
  stop(): Promise<StopDependenciesResponse>;
}

export interface OpenConnectionsDependenciesRequest {
  name: string;
}

export interface OpenConnectionsDependenciesResponse {
  database: number;
  redis: number;
}

export type StopDependenciesResponse = Record<string, never>;
