import type { JobStatus } from '@job-queue/contracts';
import { DomainError } from '@job-queue/kernel';

export interface JobStatusConflictErrorParams {
  id: string;
  /** The job's status when the operation was refused. */
  status: JobStatus;
}

/** The operation is not allowed in the job's current status, or another caller changed it first. */
export class JobStatusConflictError extends DomainError<'JOB_STATUS_CONFLICT'> {
  constructor(p: JobStatusConflictErrorParams) {
    super({
      code: 'JOB_STATUS_CONFLICT',
      message: `Job is ${p.status}; the operation is not allowed in this status`,
      details: { id: p.id, status: p.status },
    });
  }
}
