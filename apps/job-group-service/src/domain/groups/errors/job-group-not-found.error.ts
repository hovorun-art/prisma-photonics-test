import { DomainError } from '@job-queue/kernel';

export interface JobGroupNotFoundErrorParams {
  /** The id that matched no group. */
  id: string;
}

/** No job group has the requested id (never existed or was deleted). */
export class JobGroupNotFoundError extends DomainError<'JOB_GROUP_NOT_FOUND'> {
  constructor(p: JobGroupNotFoundErrorParams) {
    super({ code: 'JOB_GROUP_NOT_FOUND', message: 'Job group not found', details: { id: p.id } });
  }
}
