import { DomainError } from '@job-queue/kernel';

/** The job log stream's consumer group does not exist (the stream was deleted or flushed). */
export class JobLogStreamGroupMissingError extends DomainError<'JOB_LOG_STREAM_GROUP_MISSING'> {
  constructor() {
    super({
      code: 'JOB_LOG_STREAM_GROUP_MISSING',
      message: 'The job log stream has no consumer group',
      details: {},
    });
  }
}
