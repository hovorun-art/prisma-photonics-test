import type { CreateJobRequest } from '@job-queue/contracts';

export interface SubmitCurlCommandsRequest {
  readonly request: CreateJobRequest;
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
