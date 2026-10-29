import type { Closable } from '@job-queue/kernel';

/** One JSON log line written by the process (a line that is not JSON becomes `{ msg: line }`). */
export type LogLine = Record<string, unknown> & { msg?: string };

/** A backend service running as a child process (`node dist/main.js`). */
export interface SpawnedService {
  /** The log lines the process has written to stdout so far. */
  readonly logs: readonly LogLine[];
  /** Everything the process has written to stderr so far. */
  readonly stderr: string;
  readonly running: boolean;
  url(req: UrlSpawnedServiceRequest): UrlSpawnedServiceResponse;
  /** Sends a termination signal and resolves with how the process ended. */
  stop(req: StopSpawnedServiceRequest): Promise<StopSpawnedServiceResponse>;
  /** Last resort for a failed test, so no process is left behind: SIGKILL when still running. */
  kill(): KillSpawnedServiceResponse;
}

export interface UrlSpawnedServiceRequest {
  path: string;
}

export interface UrlSpawnedServiceResponse {
  url: string;
}

export interface StopSpawnedServiceRequest {
  signal: NodeJS.Signals;
}

export interface StopSpawnedServiceResponse {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export type KillSpawnedServiceResponse = Record<string, never>;

/** Builds a service so its compiled `dist/main.js` exists. */
export interface ServiceBuild {
  build(): Promise<BuildServiceBuildResponse>;
}

export type BuildServiceBuildResponse = Record<string, never>;

/** Starts a built service as a child process. */
export interface ServiceLauncher {
  /** Starts the process on a free port and waits until it answers its health check. */
  start(req: StartServiceLauncherRequest): Promise<StartServiceLauncherResponse>;
}

export interface StartServiceLauncherRequest {
  /** The process gets exactly this environment, plus PATH and the port variable. */
  env: Readonly<Record<string, string>>;
}

export interface StartServiceLauncherResponse {
  service: SpawnedService;
}

/** Counts the connections a client has open under a name. */
export interface RedisConnectionCounter extends Closable {
  count(req: CountRedisConnectionCounterRequest): Promise<CountRedisConnectionCounterResponse>;
}

export interface CountRedisConnectionCounterRequest {
  /** The connection name (`CLIENT SETNAME`). */
  name: string;
}

export interface CountRedisConnectionCounterResponse {
  connections: number;
}
