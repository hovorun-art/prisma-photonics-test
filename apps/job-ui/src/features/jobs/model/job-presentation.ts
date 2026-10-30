import type { Job, JobStatus } from '@job-queue/contracts';

export interface ShortIdJobPresentationRequest {
  readonly id: string;
}
export interface DetailsJobPresentationRequest {
  readonly job: Job;
}
export interface TimeJobPresentationRequest {
  /** An ISO timestamp from the API. */
  readonly at: string;
}
export interface TotalTimeJobPresentationRequest {
  readonly job: Job;
}
export interface LifecycleJobPresentationRequest {
  readonly job: Job;
}
export interface TextJobPresentationResponse {
  readonly text: string;
}
export interface TotalTimeJobPresentationResponse {
  /** `null` while the job has not both started and finished. */
  readonly text: string | null;
}
export interface LifecycleStep {
  readonly status: JobStatus;
  readonly reached: boolean;
  /** Local time of the step, when the job has one for it. */
  readonly at: string | null;
}
export interface ActionsJobPresentationRequest {
  readonly job: Job;
}
/** Which actions a job offers in its current status. */
export interface ActionsJobPresentationResponse {
  readonly cancel: boolean;
  readonly retry: boolean;
  readonly delete: boolean;
}
export interface LifecycleJobPresentationResponse {
  readonly steps: readonly LifecycleStep[];
}

/** How job-ui shows a job's fields: short ids, per-status details, local times and the lifecycle. */
export interface JobPresentation {
  shortId(req: ShortIdJobPresentationRequest): TextJobPresentationResponse;
  details(req: DetailsJobPresentationRequest): TextJobPresentationResponse;
  /** Local time of day, `HH:mm:ss`, as in the jobs list. */
  listTime(req: TimeJobPresentationRequest): TextJobPresentationResponse;
  /** Local date and time, `29 Oct, 21:02:09`, as on the job page. */
  dateTime(req: TimeJobPresentationRequest): TextJobPresentationResponse;
  totalTime(req: TotalTimeJobPresentationRequest): TotalTimeJobPresentationResponse;
  lifecycle(req: LifecycleJobPresentationRequest): LifecycleJobPresentationResponse;
  /** Cancel while it waits, retry after it failed, delete once it is finished. */
  actions(req: ActionsJobPresentationRequest): ActionsJobPresentationResponse;
}
