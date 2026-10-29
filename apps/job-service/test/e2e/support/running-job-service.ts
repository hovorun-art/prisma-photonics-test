/** job-service's environment variables (see `.env.example`) with test values. */
export const JOB_SERVICE_TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  JOB_SERVICE_PORT: '0',
  INTERNAL_SERVICE_TOKEN: 'e2e-service-token',
};

/** A running job-service, reached over HTTP. */
export interface RunningJobService {
  url(req: UrlRunningJobServiceRequest): UrlRunningJobServiceResponse;
}

export interface UrlRunningJobServiceRequest {
  path: string;
}

export interface UrlRunningJobServiceResponse {
  url: string;
}
