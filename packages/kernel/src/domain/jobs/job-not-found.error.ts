import { DomainError } from '../domain-error.js';

export interface JobNotFoundErrorParams {
  /** The id that matched no job. */
  id: string;
}

/** No job has the requested id (never existed or was deleted); used by job-service and job-execution-service. */
export class JobNotFoundError extends DomainError<'JOB_NOT_FOUND'> {
  constructor(p: JobNotFoundErrorParams) {
    super({ code: 'JOB_NOT_FOUND', message: 'Job not found', details: { id: p.id } });
  }
}
