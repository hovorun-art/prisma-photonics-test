import { DomainError } from '@job-queue/kernel';

export interface JobGroupNotEmptyErrorParams {
  id: string;
  /** How many jobs job-service reported with the group's id. */
  total: number;
}

/** A group can be deleted only while job-service has no job with its id. */
export class JobGroupNotEmptyError extends DomainError<'JOB_GROUP_NOT_EMPTY'> {
  constructor(p: JobGroupNotEmptyErrorParams) {
    super({
      code: 'JOB_GROUP_NOT_EMPTY',
      message: 'Job group has jobs and cannot be deleted',
      details: { id: p.id, total: p.total },
    });
  }
}
