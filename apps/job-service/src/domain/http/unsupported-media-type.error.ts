import { DomainError } from '@job-queue/kernel';

/** The request body uses a content encoding or charset that job-service cannot read. */
export class UnsupportedMediaTypeError extends DomainError<'UNSUPPORTED_MEDIA_TYPE'> {
  constructor() {
    super({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Request body encoding or charset is not supported',
    });
  }
}
