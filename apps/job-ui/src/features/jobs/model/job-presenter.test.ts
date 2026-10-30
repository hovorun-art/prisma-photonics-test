import type { FlightTransitJob, JobStatus } from '@job-queue/contracts';
import { describe, expect, it } from 'vitest';

import { jobFixtures, webhookJobFixtures } from '../testing/job-fixtures';
import { JobPresenter } from './job-presenter';

const presenter = new JobPresenter({ shortIdLength: 8 });

describe('JobPresenter', () => {
  /** A flight transit job; job-ui has no transit fixtures yet, since it shows nothing transit-specific. */
  const transitJob = (status: JobStatus): FlightTransitJob => ({
    ...jobFixtures.build({ status }),
    type: 'flight-transit',
    payload: { origin: 'LHR', destination: 'JFK', departureDate: '2030-06-15' },
    result: null,
  });

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

  it.each(['scheduled', 'pending', 'processing'] as const)(
    'Waiting or running webhook job: a %s job shows method and URL',
    (status) => {
      const job = webhookJobFixtures.build({ status });

      expect(presenter.details({ job }).text).toBe('POST https://hooks.example.com/orders');
    },
  );

  it('Completed webhook job: shows the HTTP status of the result', () => {
    const job = webhookJobFixtures.build({
      status: 'completed',
      result: { statusCode: 200, responseBody: { received: true } },
    });

    expect(presenter.details({ job }).text).toBe('HTTP 200');
  });

  it('Failed webhook job: shows the error message', () => {
    const job = webhookJobFixtures.build({
      status: 'failed',
      error: {
        code: 'WEBHOOK_HTTP_ERROR',
        message: 'Webhook POST https://hooks.example.com/orders answered 503',
        details: { statusCode: 503 },
      },
    });

    expect(presenter.details({ job }).text).toBe(
      'Webhook POST https://hooks.example.com/orders answered 503',
    );
  });

  it.each(['scheduled', 'pending', 'processing'] as const)(
    'a %s flight transit job has empty Details',
    (status) => {
      expect(presenter.details({ job: transitJob(status) }).text).toBe('');
    },
  );

  it('a completed flight transit job has empty Details, report and all', () => {
    const lhr = {
      iata: 'LHR',
      name: 'Heathrow Airport',
      city: 'London',
      timeZone: 'Europe/London',
      lat: 51.47,
      lon: -0.4543,
    };
    const jfk = {
      iata: 'JFK',
      name: 'John F. Kennedy International Airport',
      city: 'New York',
      timeZone: 'America/New_York',
      lat: 40.6413,
      lon: -73.7781,
    };
    const waypoint = {
      at: '2030-06-15T08:20:00.000Z',
      altitudeFt: 0,
      groundSpeedKmh: 0,
      distanceFlownKm: 0,
    };
    const job: FlightTransitJob = {
      ...transitJob('completed'),
      result: {
        flight: 'BA117',
        aircraft: { model: 'Boeing 777-300ER', registration: 'G-STBA' },
        origin: lhr,
        destination: jfk,
        departureAt: '2030-06-15T08:20:00.000Z',
        arrivalAt: '2030-06-15T16:05:00.000Z',
        distanceKm: 5555,
        durationMin: 465,
        cruiseAltitudeFt: 37_000,
        path: [
          [lhr.lat, lhr.lon],
          [jfk.lat, jfk.lon],
        ],
        waypoints: [
          { ...waypoint, name: 'Departure', lat: lhr.lat, lon: lhr.lon },
          { ...waypoint, name: 'Arrival', lat: jfk.lat, lon: jfk.lon },
        ],
      },
    };

    expect(presenter.details({ job }).text).toBe('');
  });

  it('a failed flight transit job shows its error message, like any failed job', () => {
    const job: FlightTransitJob = {
      ...transitJob('failed'),
      error: { code: 'TRANSIT_GENERATION_FAILED', message: 'No route between the airports' },
    };

    expect(presenter.details({ job }).text).toBe('No route between the airports');
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
