import type { LogLevel, NodeEnv } from '../config/base-config.js';

/** How log lines are written: JSON lines in containers, readable lines in local development. */
export const LOG_FORMATS = ['json', 'pretty'] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

/** What a service logs and how: level, request fields that never reach a log, output format. */
export interface LogPolicy {
  resolve(req: ResolveLogPolicyRequest): ResolveLogPolicyResponse;
}

export interface ResolveLogPolicyRequest {
  nodeEnv: NodeEnv;
  logLevel: LogLevel;
}

export interface ResolveLogPolicyResponse {
  level: LogLevel;
  /** Paths of logged fields replaced by a placeholder (credentials). */
  redactedPaths: readonly string[];
  format: LogFormat;
}

export const LOG_POLICY = Symbol('LogPolicy');
