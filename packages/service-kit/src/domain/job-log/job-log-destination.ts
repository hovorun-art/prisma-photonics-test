import type { Closable } from '@job-queue/kernel';
import type { JobLogSource } from '@job-queue/contracts';

import type { LogDestination } from '../logging/log-destination.js';

/** Token for a service's job log destination. */
export const JOB_LOG_DESTINATION = Symbol('JobLogDestination');

/** Where the job lines of a service's logs go: they become entries of the job's log. */
export interface JobLogDestination extends LogDestination, Closable {
  /** Resolves once entries can be sent; rejects when that takes too long. */
  open(): Promise<unknown>;
}

/** Builds the job log destination that feeds the job log stream. */
export interface JobLogDestinationFactory {
  create(req: CreateJobLogDestinationFactoryRequest): CreateJobLogDestinationFactoryResponse;
}

export interface CreateJobLogDestinationFactoryRequest {
  redisUrl: string;
  /** The service whose lines these are. */
  source: JobLogSource;
  /** Name of the destination's connection in Redis `CLIENT LIST`. */
  connectionName: string;
  /** Approximate length the stream is trimmed to. */
  maxLength: number;
}

export interface CreateJobLogDestinationFactoryResponse {
  destination: JobLogDestination;
}
