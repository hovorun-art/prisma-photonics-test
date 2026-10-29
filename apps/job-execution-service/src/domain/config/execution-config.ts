import type { BaseConfig } from '@job-queue/service-kit';

export const EXECUTION_CONFIG = Symbol('ExecutionConfig');

/**
 * The validated settings of job-execution-service. There is deliberately no database setting: this
 * service reaches job state only through job-service's internal API.
 */
export type ExecutionConfig = BaseConfig;
