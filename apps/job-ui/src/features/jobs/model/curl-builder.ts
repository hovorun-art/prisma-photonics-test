import { JOBS_ROUTE } from '@job-queue/contracts';

import type {
  CurlCommands,
  CurlCommandsResponse,
  GetCurlCommandsRequest,
  SubmitCurlCommandsRequest,
} from './curl-commands';

export interface CurlBuilderParams {
  /** Absolute URL of the API root as the browser reaches it, e.g. `http://host/api`. */
  readonly apiBaseUrl: string;
}

/** `CurlCommands` for a POSIX shell: single-quoted arguments, multi-line with `\`. */
export class CurlBuilder implements CurlCommands {
  constructor(private readonly p: CurlBuilderParams) {}

  submit(req: SubmitCurlCommandsRequest): CurlCommandsResponse {
    const body = JSON.stringify(req.request, null, 2);
    return {
      command: [
        `curl -X POST ${this.p.apiBaseUrl}${JOBS_ROUTE} \\`,
        "  -H 'Content-Type: application/json' \\",
        `  -d '${this.quote(body)}'`,
      ].join('\n'),
    };
  }

  get(req: GetCurlCommandsRequest): CurlCommandsResponse {
    return { command: `curl ${this.p.apiBaseUrl}${JOBS_ROUTE}/${req.id}` };
  }

  /** Inside single quotes a `'` ends the string: close, add an escaped quote, reopen. */
  private quote(text: string): string {
    return text.replaceAll("'", "'\\''");
  }
}
