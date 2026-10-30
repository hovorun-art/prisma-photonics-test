import { DomainError } from '../domain-error.js';

export interface JobStatusConflictErrorParams {
  id: string;
  /** The job's status when the operation was refused, when the thrower knows it. */
  status?: string;
}

/**
 * The operation is not allowed in the job's current status, or another caller changed it first;
 * used by job-service and job-execution-service.
 */
export class JobStatusConflictError extends DomainError<'JOB_STATUS_CONFLICT'> {
  constructor(p: JobStatusConflictErrorParams) {
    super({
      code: 'JOB_STATUS_CONFLICT',
      message:
        p.status === undefined
          ? 'The job status does not allow this operation'
          : `Job is ${p.status}; the operation is not allowed in this status`,
      details: p.status === undefined ? { id: p.id } : { id: p.id, status: p.status },
    });
  }
}
