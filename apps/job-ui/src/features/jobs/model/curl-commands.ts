import type { JobRequestPreview } from './job-form-draft';

export interface SubmitCurlCommandsRequest {
  /** The request to send; the submit page's preview, so it may still be incomplete. */
  readonly request: JobRequestPreview;
}
export interface GetCurlCommandsRequest {
  readonly id: string;
}
export interface CurlCommandsResponse {
  readonly command: string;
}

/** curl commands a user can copy to repeat a UI action against the API. */
export interface CurlCommands {
  submit(req: SubmitCurlCommandsRequest): CurlCommandsResponse;
  get(req: GetCurlCommandsRequest): CurlCommandsResponse;
}
