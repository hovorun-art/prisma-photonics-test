/** Nothing listens on port 1: connections are refused at once. */
export const UNREACHABLE_DATABASE_URL = 'postgresql://jobqueue:jobqueue@127.0.0.1:1/jobqueue';
export const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:1';

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
