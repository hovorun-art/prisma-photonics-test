import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JobCancellationMessage, JobQueueEntryId } from './job-queue.js';

const JOB_ID = randomUUID();

describe('JobQueueEntryId', () => {
  it('encodes a job attempt as `<jobId>_<run>_<attempt>`', () => {
    expect(JobQueueEntryId.encode({ jobId: JOB_ID, run: 3, attempt: 2 })).toBe(`${JOB_ID}_3_2`);
  });

  it('refuses to encode a run or attempt below 1', () => {
    for (const entry of [
      { jobId: JOB_ID, run: 0, attempt: 1 },
      { jobId: JOB_ID, run: 1, attempt: 0 },
    ]) {
      expect(JobQueueEntryId.safeEncode(entry).success).toBe(false);
    }
  });

  it('decodes an entry id back into the job id, run and attempt', () => {
    expect(JobQueueEntryId.decode(`${JOB_ID}_2_12`)).toEqual({
      jobId: JOB_ID,
      run: 2,
      attempt: 12,
    });
  });

  it('decodes an entry id queued before runs existed as run 1', () => {
    expect(JobQueueEntryId.decode(`${JOB_ID}_4`)).toEqual({ jobId: JOB_ID, run: 1, attempt: 4 });
  });

  it('rejects entry ids that are not a job id, a positive run and a positive attempt', () => {
    for (const id of [
      JOB_ID,
      `${JOB_ID}_0`,
      `${JOB_ID}_x`,
      `${JOB_ID}_0_1`,
      `${JOB_ID}_x_1`,
      `${JOB_ID}_1_0`,
      `${JOB_ID}_1_x`,
      `${JOB_ID}_1_2_3`,
      'abc_1',
      'abc_1_1',
      `${JOB_ID}:1`,
    ]) {
      expect(JobQueueEntryId.safeDecode(id).success).toBe(false);
    }
  });
});

describe('JobCancellationMessage', () => {
  it('accepts the id of the cancelled job', () => {
    expect(JobCancellationMessage.parse({ jobId: JOB_ID })).toEqual({ jobId: JOB_ID });
  });

  it('rejects a message without a job id or with one that is not a UUID', () => {
    for (const message of [{}, { jobId: 'abc' }, { jobId: 42 }]) {
      expect(JobCancellationMessage.safeParse(message).success).toBe(false);
    }
  });
});
