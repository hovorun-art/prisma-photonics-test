import { describe, expect, it } from 'vitest';

import { BulkIssueSplitter } from './bulk-issue-splitter';

const splitter = new BulkIssueSplitter();

describe('BulkIssueSplitter', () => {
  it("API validation error on a job's field: the issue goes to that job, relative to it", () => {
    const details = {
      issues: [{ path: ['jobs', 1, 'payload', 'url'], message: 'Invalid URL' }],
    };

    expect(splitter.split({ details, jobCount: 2 })).toEqual({
      jobs: [{ issues: [] }, { issues: [{ path: ['payload', 'url'], message: 'Invalid URL' }] }],
      unmatched: [],
    });
  });

  it('a path index given as a string still names its job', () => {
    const details = { issues: [{ path: ['jobs', '0', 'priority'], message: 'Too big' }] };

    expect(splitter.split({ details, jobCount: 1 }).jobs).toEqual([
      { issues: [{ path: ['priority'], message: 'Too big' }] },
    ]);
  });

  it('keeps several issues of several jobs in order', () => {
    const details = {
      issues: [
        { path: ['jobs', 0, 'payload', 'to'], message: 'Invalid email' },
        { path: ['jobs', 2, 'maxAttempts'], message: 'Too small' },
        { path: ['jobs', 0, 'payload', 'subject'], message: 'Required' },
      ],
    };

    expect(splitter.split({ details, jobCount: 3 }).jobs).toEqual([
      {
        issues: [
          { path: ['payload', 'to'], message: 'Invalid email' },
          { path: ['payload', 'subject'], message: 'Required' },
        ],
      },
      { issues: [] },
      { issues: [{ path: ['maxAttempts'], message: 'Too small' }] },
    ]);
  });

  it("API validation error not tied to a job's field: an issue on the list of jobs is unmatched", () => {
    const details = { issues: [{ path: ['jobs'], message: 'At most 100 jobs' }] };

    expect(splitter.split({ details, jobCount: 2 })).toEqual({
      jobs: [{ issues: [] }, { issues: [] }],
      unmatched: ['At most 100 jobs'],
    });
  });

  it('an issue on a job as a whole, with no field, is unmatched', () => {
    const details = { issues: [{ path: ['jobs', 0], message: 'Invalid job' }] };

    expect(splitter.split({ details, jobCount: 1 }).unmatched).toEqual(['Invalid job']);
  });

  it('an issue on an index without a job is unmatched', () => {
    const details = { issues: [{ path: ['jobs', 5, 'priority'], message: 'Too big' }] };

    expect(splitter.split({ details, jobCount: 2 })).toEqual({
      jobs: [{ issues: [] }, { issues: [] }],
      unmatched: ['Too big'],
    });
  });

  it.each(['', 'x', '1.5', '-1'])('an issue on the job index %j is unmatched', (index) => {
    const details = { issues: [{ path: ['jobs', index, 'priority'], message: 'Too big' }] };

    expect(splitter.split({ details, jobCount: 2 })).toEqual({
      jobs: [{ issues: [] }, { issues: [] }],
      unmatched: ['Too big'],
    });
  });

  it('details that do not match the validation contract give no issues at all', () => {
    expect(splitter.split({ details: { issues: 'x' }, jobCount: 1 })).toEqual({
      jobs: [{ issues: [] }],
      unmatched: [],
    });
  });

  it('an issue outside the jobs is unmatched', () => {
    const details = { issues: [{ path: ['body'], message: 'Body is required' }] };

    expect(splitter.split({ details, jobCount: 1 }).unmatched).toEqual(['Body is required']);
  });

  it('details without issues give no issues at all', () => {
    expect(splitter.split({ details: {}, jobCount: 2 })).toEqual({
      jobs: [{ issues: [] }, { issues: [] }],
      unmatched: [],
    });
  });
});
