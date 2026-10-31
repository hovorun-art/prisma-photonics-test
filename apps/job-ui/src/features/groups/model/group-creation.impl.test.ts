import type { CreateJobRequest } from '@job-queue/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';

import { ApiError } from '../../jobs/api/api-error';
import type { JobsApi } from '../../jobs/api/jobs-api';
import { jobFixtures, webhookJobFixtures } from '../../jobs/testing/job-fixtures';
import type { GroupsApi } from '../api/groups-api';
import { groupFixtures } from '../testing/group-fixtures';
import { GroupCreationImpl } from './group-creation.impl';

const groups = mockDeep<GroupsApi>();
const jobs = mockDeep<JobsApi>();
const creation = new GroupCreationImpl({ groups, jobs });

const EMAIL: CreateJobRequest = {
  type: 'email',
  payload: jobFixtures.build().payload,
  priority: 5,
  maxAttempts: 3,
};
const WEBHOOK: CreateJobRequest = {
  type: 'webhook',
  payload: webhookJobFixtures.build().payload,
  priority: 1,
  maxAttempts: 2,
};
const SUBMIT_ERROR = new ApiError({
  status: 400,
  code: 'VALIDATION_FAILED',
  message: 'Validation failed',
  details: { issues: [] },
});

describe('GroupCreationImpl', () => {
  beforeEach(() => {
    mockReset(groups);
    mockReset(jobs);
  });

  it('Create a group with two jobs: submits every job with the group id, in order', async () => {
    const group = groupFixtures.build({ total: 0, completed: 0, failed: 0 });
    groups.create.mockResolvedValueOnce({ group });
    jobs.createBulk.mockResolvedValueOnce({ jobs: [] });

    await expect(creation.create({ jobs: [EMAIL, WEBHOOK] })).resolves.toEqual({ group });

    expect(jobs.createBulk).toHaveBeenCalledExactlyOnceWith({
      jobs: [
        { ...EMAIL, groupId: group.id },
        { ...WEBHOOK, groupId: group.id },
      ],
    });
    expect(groups.delete).not.toHaveBeenCalled();
  });

  it('Group cannot be created: the error is thrown and no job is submitted', async () => {
    const error = new ApiError({ status: null, code: null, message: 'API unreachable' });
    groups.create.mockRejectedValueOnce(error);

    await expect(creation.create({ jobs: [EMAIL] })).rejects.toBe(error);

    expect(jobs.createBulk).not.toHaveBeenCalled();
    expect(groups.delete).not.toHaveBeenCalled();
  });

  it('Group deleted after a failed submit: the empty group is deleted, the submit error thrown', async () => {
    const group = groupFixtures.build();
    groups.create.mockResolvedValueOnce({ group });
    jobs.createBulk.mockRejectedValueOnce(SUBMIT_ERROR);
    groups.delete.mockResolvedValueOnce({ id: group.id });

    await expect(creation.create({ jobs: [EMAIL] })).rejects.toBe(SUBMIT_ERROR);

    expect(groups.delete).toHaveBeenCalledExactlyOnceWith({ id: group.id });
  });

  it('Delete fails after a failed submit: the submit error is thrown, not the delete error', async () => {
    const group = groupFixtures.build();
    groups.create.mockResolvedValueOnce({ group });
    jobs.createBulk.mockRejectedValueOnce(SUBMIT_ERROR);
    groups.delete.mockRejectedValueOnce(
      new ApiError({ status: 503, code: 'JOB_SERVICE_UNAVAILABLE', message: 'Unavailable' }),
    );

    await expect(creation.create({ jobs: [EMAIL] })).rejects.toBe(SUBMIT_ERROR);

    expect(groups.delete).toHaveBeenCalledExactlyOnceWith({ id: group.id });
  });

  it('Try again after a failed submit: the second try uses a new group id', async () => {
    const failed = groupFixtures.build();
    const created = groupFixtures.build();
    groups.create.mockResolvedValueOnce({ group: failed });
    jobs.createBulk.mockRejectedValueOnce(SUBMIT_ERROR);
    groups.delete.mockResolvedValueOnce({ id: failed.id });
    await creation.create({ jobs: [EMAIL] }).catch(() => undefined);
    groups.create.mockResolvedValueOnce({ group: created });
    jobs.createBulk.mockResolvedValueOnce({ jobs: [] });

    await expect(creation.create({ jobs: [EMAIL] })).resolves.toEqual({ group: created });

    expect(groups.create).toHaveBeenCalledTimes(2);
    expect(jobs.createBulk).toHaveBeenCalledTimes(2);
    expect(jobs.createBulk).toHaveBeenNthCalledWith(2, {
      jobs: [{ ...EMAIL, groupId: created.id }],
    });
  });
});
