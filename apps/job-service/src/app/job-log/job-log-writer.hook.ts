import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { JOB_LOG_STORE, type JobLogStore } from '../../domain/job-log/job-log-store.js';
import { JOB_LOG_STREAM, type JobLogStream } from '../../domain/job-log/job-log-stream.js';
import { JOB_LOG_WRITER, type JobLogWriter } from '../../domain/job-log/job-log-writer.js';

/**
 * Starts the job log writer without waiting for the store (the writer applies the store's schema
 * itself, retrying while the store is down), and on shutdown stops it before the store and the
 * stream it works with are closed.
 */
@Injectable()
export class JobLogWriterHook implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(JOB_LOG_WRITER) private readonly writer: JobLogWriter,
    @Inject(JOB_LOG_STORE) private readonly store: JobLogStore,
    @Inject(JOB_LOG_STREAM) private readonly stream: JobLogStream,
  ) {}

  onApplicationBootstrap(): void {
    this.writer.start();
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.writer.stop();
    } finally {
      try {
        await this.store.close();
      } finally {
        await this.stream.close();
      }
    }
  }
}
