import type {
  JobServiceHttp,
  SendJobServiceHttpRequest,
  SendJobServiceHttpResponse,
} from '../domain/jobs/job-service-http.js';
import { JobServiceUnavailableError } from '../domain/jobs/job-service-unavailable.error.js';

export interface FetchJobServiceHttpDeps {
  /** The global `fetch`, injected so tests answer without a network. */
  fetch: typeof globalThis.fetch;
}

export interface FetchJobServiceHttpParams {
  /** job-service's base URL, e.g. `http://job-service:3000`. */
  baseUrl: string;
  /** How long one call may take before job-service counts as unavailable. */
  timeoutMs: number;
}

/**
 * HTTP to job-service with `fetch`: JSON in and out, a timeout per call, and one rule for an
 * unavailable job-service (network error, timeout or 5xx → `JobServiceUnavailableError`) shared by
 * every service that calls it.
 */
export class FetchJobServiceHttp implements JobServiceHttp {
  constructor(
    private readonly d: FetchJobServiceHttpDeps,
    private readonly p: FetchJobServiceHttpParams,
  ) {}

  async send(req: SendJobServiceHttpRequest): Promise<SendJobServiceHttpResponse> {
    const url = new URL(req.path, this.p.baseUrl);
    for (const [name, value] of req.query ?? []) url.searchParams.append(name, value);
    const hasBody = req.body !== undefined;

    let response: Response;
    try {
      response = await this.d.fetch(url, {
        method: req.method,
        headers: { ...req.headers, ...(hasBody ? { 'content-type': 'application/json' } : {}) },
        ...(hasBody ? { body: JSON.stringify(req.body) } : {}),
        signal: AbortSignal.any([
          AbortSignal.timeout(this.p.timeoutMs),
          ...(req.signal === undefined ? [] : [req.signal]),
        ]),
      });
    } catch (error) {
      throw new JobServiceUnavailableError({
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    if (response.status >= 500) {
      throw new JobServiceUnavailableError({ reason: `HTTP ${response.status}` });
    }
    const body: unknown = await response.json().catch(() => undefined);
    return { status: response.status, body };
  }
}
