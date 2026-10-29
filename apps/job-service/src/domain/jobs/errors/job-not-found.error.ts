import { DomainError } from '@job-queue/kernel';

export interface JobNotFoundErrorParams {
  /** The id that matched no job. */
  id: string;
}

/** No job has the requested id (never existed or was deleted). */
export class JobNotFoundError extends DomainError<'JOB_NOT_FOUND'> {
  constructor(p: JobNotFoundErrorParams) {
    super({ code: 'JOB_NOT_FOUND', message: 'Job not found', details: { id: p.id } });
  }
}
