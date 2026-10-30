import { ErrorBody } from '@job-queue/contracts';

import { ApiError } from './api-error';
import type {
  JsonApiClient,
  ReadJsonApiClientRequest,
  ReadJsonApiClientResponse,
  SendJsonApiClientRequest,
  SendJsonApiClientResponse,
} from './json-api-client';

export interface FetchJsonApiClientParams {
  /** Absolute URL of the API root as the browser reaches it, e.g. `http://host/api`. */
  readonly baseUrl: string;
  /** Message of an `ApiError` when the service could not be reached or answered without an error body. */
  readonly networkErrorMessage: string;
}

/** `JsonApiClient` over `fetch`. */
export class FetchJsonApiClient implements JsonApiClient {
  constructor(private readonly p: FetchJsonApiClientParams) {}

  async send(req: SendJsonApiClientRequest): Promise<SendJsonApiClientResponse> {
    const headers = new Headers(req.init.headers);
    headers.set('Accept', 'application/json');
    let response: Response;
    try {
      response = await fetch(`${this.p.baseUrl}${req.path}`, { ...req.init, headers });
    } catch {
      throw this.networkError(null);
    }
    if (!response.ok) throw await this.errorOf(response);
    return { response };
  }

  async read<T>(req: ReadJsonApiClientRequest<T>): Promise<ReadJsonApiClientResponse<T>> {
    const body = req.schema.safeParse(await req.response.json().catch(() => null));
    if (!body.success) throw this.networkError(req.response.status);
    return { body: body.data };
  }

  private async errorOf(response: Response): Promise<ApiError> {
    const body = ErrorBody.safeParse(await response.json().catch(() => null));
    if (!body.success) return this.networkError(response.status);
    return new ApiError({ status: response.status, ...body.data });
  }

  private networkError(status: number | null): ApiError {
    return new ApiError({ status, code: null, message: this.p.networkErrorMessage });
  }
}
