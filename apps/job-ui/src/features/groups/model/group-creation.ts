import type { CreateJobRequest, JobGroup } from '@job-queue/contracts';

import type { JobsApi } from '../../jobs/api/jobs-api';
import type { GroupsApi } from '../api/groups-api';

export interface CreateGroupCreationRequest {
  /** The group's jobs in tab order, without a group id. */
  readonly jobs: readonly CreateJobRequest[];
}
export interface CreateGroupCreationResponse {
  readonly group: JobGroup;
}

export interface GroupCreationDeps {
  readonly groups: GroupsApi;
  readonly jobs: JobsApi;
}

/**
 * Creates a group with its jobs across the two services: an empty group first, then all jobs in
 * one bulk submit with the group's id. When the submit fails, the still-empty group is deleted and
 * the submit's error is thrown (a failed delete is ignored). Throws the API's `ApiError`.
 */
export interface GroupCreation {
  create(req: CreateGroupCreationRequest): Promise<CreateGroupCreationResponse>;
}
