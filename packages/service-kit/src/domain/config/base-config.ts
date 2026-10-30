export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The settings every backend service has (variable names and values in `.env.example`). */
export interface CoreConfig {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
  /** Port of the service's HTTP server; 0 picks a free port. */
  readonly port: number;
}

/** The settings of a backend on the job queue: the core ones plus Redis and the internal API token. */
export interface BaseConfig extends CoreConfig {
  readonly redisUrl: string;
  /** The shared token of the internal API; every backend on the queue must hold the same one. */
  readonly internalServiceToken: string;
  /** Most entries the job log stream keeps (trimmed approximately); older unread ones are lost. */
  readonly jobLogStreamMaxLength: number;
}
