import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JobQueueEntryId } from './job-queue.js';

const JOB_ID = randomUUID();

describe('JobQueueEntryId', () => {
  it('encodes a job attempt as `<jobId>_<attempt>`', () => {
    expect(JobQueueEntryId.encode({ jobId: JOB_ID, attempt: 2 })).toBe(`${JOB_ID}_2`);
  });

  it('decodes an entry id back into the job id and attempt', () => {
    expect(JobQueueEntryId.decode(`${JOB_ID}_12`)).toEqual({ jobId: JOB_ID, attempt: 12 });
  });

  it('rejects entry ids that are not a job id and a positive attempt', () => {
    for (const id of [JOB_ID, `${JOB_ID}_0`, `${JOB_ID}_x`, 'abc_1', `${JOB_ID}:1`]) {
      expect(JobQueueEntryId.safeDecode(id).success).toBe(false);
    }
  });
});
