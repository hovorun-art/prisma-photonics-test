import { describe, expect, it } from 'vitest';

import { jobFixtures } from '../testing/job-fixtures';
import { JobPresenter } from './job-presenter';

const presenter = new JobPresenter({ shortIdLength: 8 });

describe('JobPresenter', () => {
  it('shortId: the first characters of the id', () => {
    expect(presenter.shortId({ id: '7f3a9c21-4b5d-4e6f-8a7b-9c0d1e2f3a4b' })).toEqual({
      text: '7f3a9c21',
    });
  });

  it.each(['scheduled', 'pending', 'processing'] as const)(
    'Waiting or running email job: a %s job shows recipient and subject',
    (status) => {
      const job = jobFixtures.build({ status });

      expect(presenter.details({ job }).text).toBe('to ops@acme.test · “Weekly digest”');
    },
  );

  it('Completed email job: shows the message id', () => {
    const job = jobFixtures.build({ status: 'completed', result: { messageId: 'msg_01HF8Z2K4' } });

    expect(presenter.details({ job }).text).toBe('msg_01HF8Z2K4');
  });

  it('Failed email job: shows the error message', () => {
    const job = jobFixtures.build({
      status: 'failed',
      error: { code: 'EMAIL_SEND_FAILED', message: 'SMTP timeout' },
    });

    expect(presenter.details({ job }).text).toBe('SMTP timeout');
  });

  it('listTime: local time of day', () => {
    expect(presenter.listTime({ at: '2026-10-29T21:02:09.000Z' })).toEqual({ text: '21:02:09' });
  });

  it('Times on the job page: date-time is local day, month and time', () => {
    expect(presenter.dateTime({ at: '2026-10-29T21:02:09.000Z' })).toEqual({
      text: '29 Oct, 21:02:09',
    });
  });

  it('Times on the job page: total time runs from started to finished', () => {
    const quick = jobFixtures.build({
      startedAt: '2026-10-29T21:02:10.000Z',
      completedAt: '2026-10-29T21:02:20.300Z',
    });
    const long = jobFixtures.build({
      startedAt: '2026-10-29T21:02:10.000Z',
      completedAt: '2026-10-29T21:05:14.000Z',
    });

    expect(presenter.totalTime({ job: quick })).toEqual({ text: '10.3s' });
    expect(presenter.totalTime({ job: long })).toEqual({ text: '3m 4s' });
  });

  it('total time is unknown until the job has finished', () => {
    const job = jobFixtures.build({ startedAt: '2026-10-29T21:02:10.000Z' });

    expect(presenter.totalTime({ job })).toEqual({ text: null });
  });

  it('Lifecycle of a completed job: pending, processing and completed are reached, with times', () => {
    const job = jobFixtures.build({
      status: 'completed',
      startedAt: '2026-10-29T21:02:10.000Z',
      completedAt: '2026-10-29T21:02:20.000Z',
      result: { messageId: 'msg_1' },
    });

    expect(presenter.lifecycle({ job }).steps).toEqual([
      { status: 'pending', reached: true, at: '21:02:09' },
      { status: 'processing', reached: true, at: '21:02:10' },
      { status: 'completed', reached: true, at: '21:02:20' },
    ]);
  });

  it('Lifecycle of a failed job: the last step is failed', () => {
    const job = jobFixtures.build({
      status: 'failed',
      startedAt: '2026-10-29T21:02:10.000Z',
      completedAt: '2026-10-29T21:02:20.000Z',
      error: { code: 'X', message: 'boom' },
    });

    expect(presenter.lifecycle({ job }).steps.at(-1)).toEqual({
      status: 'failed',
      reached: true,
      at: '21:02:20',
    });
  });

  it('Lifecycle of a pending job: pending is reached, processing is not yet', () => {
    const job = jobFixtures.build({ status: 'pending' });

    expect(presenter.lifecycle({ job }).steps).toEqual([
      { status: 'pending', reached: true, at: '21:02:09' },
      { status: 'processing', reached: false, at: null },
      { status: 'completed', reached: false, at: null },
    ]);
  });

  it.each([
    ['scheduled', { cancel: true, retry: false, delete: false }],
    ['pending', { cancel: true, retry: false, delete: false }],
    ['processing', { cancel: false, retry: false, delete: false }],
    ['completed', { cancel: false, retry: false, delete: true }],
    ['failed', { cancel: false, retry: true, delete: true }],
    ['cancelled', { cancel: false, retry: false, delete: true }],
  ] as const)('actions: a %s job offers %o', (status, actions) => {
    expect(presenter.actions({ job: jobFixtures.build({ status }) })).toEqual(actions);
  });
});
