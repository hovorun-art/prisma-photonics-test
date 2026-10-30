import type { CreateJobRequest } from '@job-queue/contracts';

/**
 * A short, stable digest of what a submission asks for (type, payload, priority, max attempts,
 * scheduled instant and group, defaults applied, the idempotency key left out). Two submissions
 * ask for the same job exactly when their fingerprints are equal, whatever the key order of the
 * payload or the time zone notation of `scheduledAt`.
 */
export interface JobRequestFingerprint {
  of(req: OfJobRequestFingerprintRequest): OfJobRequestFingerprintResponse;
}

export interface OfJobRequestFingerprintRequest {
  /** The submission as parsed by the contract, so its defaults are applied. */
  job: CreateJobRequest;
}

export interface OfJobRequestFingerprintResponse {
  fingerprint: string;
}

export const JOB_REQUEST_FINGERPRINT = Symbol('JobRequestFingerprint');
