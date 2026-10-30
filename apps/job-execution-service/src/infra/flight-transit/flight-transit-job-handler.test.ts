import { randomUUID } from 'node:crypto';

import type { FlightTransitJob, FlightTransitJobResult } from '@job-queue/contracts';
import type { Random, Sleeper } from '@job-queue/kernel';
import type { LoggerService } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';

import type { TransitReportGenerator } from '../../domain/flight-transit/transit-report-generator.js';
import { FlightTransitJobHandler } from './flight-transit-job-handler.js';

const PARAMS = { generateMs: 2000, failureRate: 0.1 };
/** The queue entry's attempt; the job read before start still counts one fewer. */
const ATTEMPT = 2;

const JOB: FlightTransitJob = {
  id: randomUUID(),
  type: 'flight-transit',
  payload: { origin: 'LHR', destination: 'JFK', departureDate: '2026-11-02' },
  status: 'processing',
  priority: 5,
  attempts: 1,
  maxAttempts: 3,
  result: null,
  error: null,
  scheduledAt: null,
  startedAt: '2026-10-29T12:00:00.000Z',
  completedAt: null,
  createdAt: '2026-10-29T11:00:00.000Z',
  updatedAt: '2026-10-29T12:00:00.000Z',
};

const REPORT: FlightTransitJobResult = {
  flight: 'BA 117',
  aircraft: { model: 'B777-300ER', registration: 'G-XWBA' },
  origin: {
    iata: 'LHR',
    name: 'Heathrow',
    city: 'London',
    timeZone: 'Europe/London',
    lat: 51.47,
    lon: -0.45,
  },
  destination: {
    iata: 'JFK',
    name: 'John F. Kennedy',
    city: 'New York',
    timeZone: 'America/New_York',
    lat: 40.64,
    lon: -73.78,
  },
  departureAt: '2026-11-02T10:35:00.000Z',
  arrivalAt: '2026-11-02T17:10:00.000Z',
  distanceKm: 5540,
  durationMin: 395,
  cruiseAltitudeFt: 39_000,
  path: [
    [51.47, -0.45],
    [40.64, -73.78],
  ],
  waypoints: [
    {
      name: 'LHR',
      at: '2026-11-02T10:35:00.000Z',
      lat: 51.47,
      lon: -0.45,
      altitudeFt: 0,
      groundSpeedKmh: 30,
      distanceFlownKm: 0,
    },
    {
      name: 'JFK',
      at: '2026-11-02T17:10:00.000Z',
      lat: 40.64,
      lon: -73.78,
      altitudeFt: 0,
      groundSpeedKmh: 30,
      distanceFlownKm: 5540,
    },
  ],
};

describe('FlightTransitJobHandler', () => {
  let random: DeepMockProxy<Random>;
  let sleeper: DeepMockProxy<Sleeper>;
  let reports: DeepMockProxy<TransitReportGenerator>;
  let logger: DeepMockProxy<Pick<LoggerService, 'log'>>;
  const signal = new AbortController().signal;

  const handler = (failureRate = PARAMS.failureRate): FlightTransitJobHandler =>
    new FlightTransitJobHandler({ random, sleeper, reports, logger }, { ...PARAMS, failureRate });

  beforeEach(() => {
    random = mockDeep<Random>();
    sleeper = mockDeep<Sleeper>();
    reports = mockDeep<TransitReportGenerator>();
    logger = mockDeep<Pick<LoggerService, 'log'>>();
  });

  it('Flight transit job takes the configured time', async () => {
    let wake: () => void = () => undefined;
    sleeper.sleep.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          wake = () => {
            resolve({});
          };
        }),
    );
    random.next.mockReturnValueOnce({ value: 0.9 });
    reports.generate.mockReturnValueOnce({ report: REPORT });

    let finished = false;
    const running = handler()
      .run({ job: JOB, attempt: ATTEMPT, signal })
      .then(() => {
        finished = true;
      });
    await Promise.resolve();

    expect(sleeper.sleep).toHaveBeenCalledExactlyOnceWith({ ms: PARAMS.generateMs, signal });
    expect(random.next).not.toHaveBeenCalled();
    expect(finished).toBe(false);
    wake();
    await running;
    expect(finished).toBe(true);
  });

  it('Transit failure rate zero never fails', async () => {
    const neverFails = handler(0);
    // `next()` is in [0, 1): even its lowest value is not below a zero rate.
    for (const [i, value] of [0, 0.5, 0.999].entries()) {
      // Each run gets its own report, so a handler reusing an earlier one would fail.
      const report = { ...REPORT, flight: `BA ${String(i + 1)}` };
      sleeper.sleep.mockResolvedValueOnce({});
      random.next.mockReturnValueOnce({ value });
      reports.generate.mockReturnValueOnce({ report });

      const response = await neverFails.run({ job: JOB, attempt: ATTEMPT, signal });

      expect(response).toEqual({ outcome: 'completed', result: report });
    }
    expect(reports.generate).toHaveBeenCalledTimes(3);
    expect(reports.generate).toHaveBeenCalledWith({ payload: JOB.payload });
  });

  it('Transit failure rate one always fails', async () => {
    const alwaysFails = handler(1);
    for (const value of [0, 0.5, 0.999]) {
      sleeper.sleep.mockResolvedValueOnce({});
      random.next.mockReturnValueOnce({ value });

      const response = await alwaysFails.run({ job: JOB, attempt: ATTEMPT, signal });

      expect(response.outcome).toBe('failed');
    }
    expect(reports.generate).not.toHaveBeenCalled();
  });

  it('Failed transit attempt carries the route', async () => {
    sleeper.sleep.mockResolvedValueOnce({});
    random.next.mockReturnValueOnce({ value: 0.05 });

    const response = await handler().run({ job: JOB, attempt: ATTEMPT, signal });

    expect(response).toEqual({
      outcome: 'failed',
      error: {
        code: 'FLIGHT_TRANSIT_DATA_UNAVAILABLE',
        message: 'Flight data for LHR-JFK is unavailable',
        details: { origin: 'LHR', destination: 'JFK' },
      },
    });
    expect(reports.generate).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('Generated flight is logged', async () => {
    sleeper.sleep.mockResolvedValueOnce({});
    random.next.mockReturnValueOnce({ value: PARAMS.failureRate });
    reports.generate.mockReturnValueOnce({ report: REPORT });

    // A draw equal to the rate is not below it, so the attempt completes.
    const response = await handler().run({ job: JOB, attempt: ATTEMPT, signal });

    expect(response).toEqual({ outcome: 'completed', result: REPORT });
    expect(logger.log).toHaveBeenCalledExactlyOnceWith(
      { jobId: JOB.id, attempt: ATTEMPT, flight: 'BA 117', distanceKm: 5540, durationMin: 395 },
      'Transit report generated',
    );
  });

  it('draws nothing when the wait is aborted', async () => {
    const aborted = new Error('aborted');
    sleeper.sleep.mockRejectedValueOnce(aborted);

    await expect(handler().run({ job: JOB, attempt: ATTEMPT, signal })).rejects.toBe(aborted);

    expect(random.next).not.toHaveBeenCalled();
    expect(reports.generate).not.toHaveBeenCalled();
  });

  it('passes on an error of the generator without logging a report', async () => {
    const broken = new Error('generator bug');
    sleeper.sleep.mockResolvedValueOnce({});
    random.next.mockReturnValueOnce({ value: 0.9 });
    reports.generate.mockImplementationOnce(() => {
      throw broken;
    });

    await expect(handler().run({ job: JOB, attempt: ATTEMPT, signal })).rejects.toBe(broken);

    expect(logger.log).not.toHaveBeenCalled();
  });
});
