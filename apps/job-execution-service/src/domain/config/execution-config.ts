import type { BaseConfig } from '@job-queue/service-kit';

export const EXECUTION_CONFIG = Symbol('ExecutionConfig');

/**
 * The validated settings of job-execution-service. There is deliberately no database setting: this
 * service reaches job state only through job-service's internal API.
 */
export interface ExecutionConfig extends BaseConfig {
  /** Base URL of job-service, e.g. `http://job-service:3000`. */
  readonly jobServiceUrl: string;
  /** How many jobs one instance runs at the same time. */
  readonly concurrency: number;
  /** The simulated send time of an email job lies in [min, max] milliseconds. */
  readonly emailSendMinMs: number;
  readonly emailSendMaxMs: number;
  /** How long a simulated webhook call takes, in milliseconds. */
  readonly webhookCallMs: number;
  /** The share of webhook attempts that fail, in [0, 1]. */
  readonly webhookFailureRate: number;
  /**
   * How often a call to job-service that could not reach it is tried again; the wait before the
   * first retry, doubling (randomized) up to the maximum.
   */
  readonly reportRetries: number;
  readonly reportRetryDelayMs: number;
  readonly reportRetryMaxDelayMs: number;
  /** How long one call to job-service may take. */
  readonly jobServiceTimeoutMs: number;
  /** How long a shutdown waits for running jobs. */
  readonly shutdownGraceMs: number;
}
