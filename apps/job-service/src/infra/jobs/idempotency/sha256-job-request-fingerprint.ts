import { createHash } from 'node:crypto';

import { stringify } from 'safe-stable-stringify';

import type {
  JobRequestFingerprint,
  OfJobRequestFingerprintRequest,
  OfJobRequestFingerprintResponse,
} from '../../../domain/jobs/job-request-fingerprint.js';

/**
 * The SHA-256 (hex) of the canonical request: the fields that define the job, the optional ones
 * as `null` and `scheduledAt` as a UTC instant, serialised with sorted object keys.
 */
export class Sha256JobRequestFingerprint implements JobRequestFingerprint {
  of({ job }: OfJobRequestFingerprintRequest): OfJobRequestFingerprintResponse {
    const canonical: Record<string, unknown> = {
      type: job.type,
      payload: job.payload,
      priority: job.priority,
      maxAttempts: job.maxAttempts,
      groupId: job.groupId ?? null,
      scheduledAt: job.scheduledAt === undefined ? null : new Date(job.scheduledAt).toISOString(),
    };
    return { fingerprint: createHash('sha256').update(stringify(canonical)).digest('hex') };
  }
}
