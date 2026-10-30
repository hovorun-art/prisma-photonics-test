import type { z } from 'zod';

export interface SendJsonApiClientRequest {
  /** Path below the API root, with its query string. */
  readonly path: string;
  readonly init: RequestInit;
}
export interface SendJsonApiClientResponse {
  readonly response: Response;
}

export interface ReadJsonApiClientRequest<T> {
  readonly schema: z.ZodType<T>;
  readonly response: Response;
}
export interface ReadJsonApiClientResponse<T> {
  readonly body: T;
}

/**
 * The browser's JSON calls to a service behind the API root, shared by the feature APIs. Both
 * methods throw `ApiError`: with the service's error code when it answered with an error body,
 * without one when it could not be reached or answered something else.
 */
export interface JsonApiClient {
  /** Sends the call; a non-2xx answer throws. */
  send(req: SendJsonApiClientRequest): Promise<SendJsonApiClientResponse>;
  /** Parses an answer's body with a contract schema; a body that does not match throws. */
  read<T>(req: ReadJsonApiClientRequest<T>): Promise<ReadJsonApiClientResponse<T>>;
}
