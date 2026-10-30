import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';

import {
  JOB_LOG_DESTINATION,
  type JobLogDestination,
} from '../../domain/job-log/job-log-destination.js';

/**
 * Opens the job log destination before the app takes work and closes it at shutdown. Module
 * initialisation finishes before any module's bootstrap hook, so the connection is ready (or given
 * up on) before, for example, a queue consumer takes its first entry. Logging never blocks the
 * service: without the connection the job lines are only dropped.
 *
 * Provide it in the root module, so its shutdown hook runs after the last log line of the others.
 */
@Injectable()
export class JobLogDestinationHook implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JobLogDestinationHook.name);

  constructor(@Inject(JOB_LOG_DESTINATION) private readonly jobLog: JobLogDestination) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.jobLog.open();
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Job log unavailable at startup: job log entries are dropped until Redis answers',
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.jobLog.close();
  }
}
