export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The settings every backend service has (variable names and values in `.env.example`). */
export interface BaseConfig {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
  readonly redisUrl: string;
  /** Port of the service's HTTP server; 0 picks a free port. */
  readonly port: number;
  /** The shared token of the internal API; every backend must hold the same one. */
  readonly internalServiceToken: string;
}
