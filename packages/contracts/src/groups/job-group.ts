import { z } from 'zod';

/** Public routes of job-group-service. */
export const JOB_GROUPS_ROUTE = '/v1/groups';

/** A group runs until every child job has finished; then it completed or failed. */
export const JobGroupStatus = z.enum(['running', 'completed', 'failed']);
export type JobGroupStatus = z.infer<typeof JobGroupStatus>;

const Count = z.number().int().min(0);
const Timestamp = z.iso.datetime();

/**
 * A job group as every group route returns it. Its id is the `groupId` of its child jobs in
 * job-service. `total` is the highest child count job-service has reported; `failed` counts failed,
 * cancelled and missing children. The stats are as of `checkedAt`, the last successful poll.
 */
export const JobGroup = z.object({
  id: z.uuid(),
  status: JobGroupStatus,
  total: Count,
  completed: Count,
  failed: Count,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  checkedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
});
export type JobGroup = z.infer<typeof JobGroup>;

/** Path parameters of the routes that address one group. */
export const JobGroupIdParams = z.object({ id: z.uuid() });
export type JobGroupIdParams = z.infer<typeof JobGroupIdParams>;

/**
 * Query string of `GET /v1/groups`. Without `limit` job-group-service uses its configured default
 * page size; the configured maximum is checked by the service, since it is runtime config.
 */
export const QueryJobGroupsRequest = z.object({
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).default(0),
});
export type QueryJobGroupsRequest = z.infer<typeof QueryJobGroupsRequest>;

/** One page of groups, newest first, and the number of all groups. */
export const QueryJobGroupsResponse = z.object({
  items: z.array(JobGroup),
  total: Count,
});
export type QueryJobGroupsResponse = z.infer<typeof QueryJobGroupsResponse>;
