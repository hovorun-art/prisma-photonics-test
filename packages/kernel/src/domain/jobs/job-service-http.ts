/** Token for the HTTP connection to job-service that its client services share. */
export const JOB_SERVICE_HTTP = Symbol('JobServiceHttp');

/**
 * One HTTP call to job-service. Throws `JobServiceUnavailableError` when job-service cannot be
 * reached, does not answer within the configured timeout, or answers with a 5xx; any other answer,
 * a 4xx included, is returned for the caller to interpret.
 */
export interface JobServiceHttp {
  send(req: SendJobServiceHttpRequest): Promise<SendJobServiceHttpResponse>;
}

export interface SendJobServiceHttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path of the route, e.g. `/v1/jobs`. */
  path: string;
  /** Query parameters; a name may repeat (`status=failed&status=cancelled`). */
  query?: readonly (readonly [string, string])[];
  headers?: Readonly<Record<string, string>>;
  /** Sent as JSON when present. */
  body?: unknown;
  /** Aborts the call early, on top of the timeout. */
  signal?: AbortSignal | undefined;
}

export interface SendJobServiceHttpResponse {
  status: number;
  /** The parsed JSON body; `undefined` when there is none or it is not JSON. */
  body: unknown;
}
