import type { LoggerService } from '@nestjs/common';
import type {
  ErrorShutdownLogRequest,
  ErrorShutdownLogResponse,
  InfoShutdownLogRequest,
  InfoShutdownLogResponse,
  ShutdownLog,
} from '@job-queue/kernel';

export interface NestShutdownLogDeps {
  logger: Pick<LoggerService, 'log' | 'error'>;
}

/** The kernel's shutdown log, written through a Nest logger (pino once the app is created). */
export class NestShutdownLog implements ShutdownLog {
  constructor(private readonly d: NestShutdownLogDeps) {}

  info(req: InfoShutdownLogRequest): InfoShutdownLogResponse {
    this.d.logger.log(req.message);
    return {};
  }

  error(req: ErrorShutdownLogRequest): ErrorShutdownLogResponse {
    this.d.logger.error({ err: req.err }, req.message);
    return {};
  }
}
