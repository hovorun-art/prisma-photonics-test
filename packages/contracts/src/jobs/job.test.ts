import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ChangeJobStatusRequest,
  CreateJobRequest,
  CreateJobsBulkRequest,
  EMAIL_LIMITS,
  EmailJobResult,
  FlightTransitJobResult,
  Job,
  JOB_LIMITS,
  JobIdParams,
  QueryJobsRequest,
  UpdateJobRequest,
  WEBHOOK_LIMITS,
  WEBHOOK_METHODS,
  WebhookJobResult,
} from './job.js';

const validEmailJob = {
  type: 'email',
  payload: { to: 'ada@example.com', subject: 'Hello', body: 'Hi Ada' },
  priority: 7,
  maxAttempts: 4,
};

describe('CreateJobRequest', () => {
  const issuePaths = (input: unknown): PropertyKey[][] =>
    CreateJobRequest.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

  it('Valid email job is accepted', () => {
    expect(CreateJobRequest.parse(validEmailJob)).toEqual(validEmailJob);
  });

  it('Defaults are applied', () => {
    const { priority: _priority, maxAttempts: _maxAttempts, ...withoutOptions } = validEmailJob;

    const parsed = CreateJobRequest.parse(withoutOptions);

    expect(parsed.priority).toBe(JOB_LIMITS.priority.default);
    expect(parsed.maxAttempts).toBe(JOB_LIMITS.maxAttempts.default);
  });

  it('Job without an execution time', () => {
    expect(CreateJobRequest.parse(validEmailJob).scheduledAt).toBeUndefined();
  });

  it('Execution time with a time zone offset', () => {
    for (const scheduledAt of ['2026-11-02T08:30:00Z', '2026-11-02T10:30:00.250+02:00']) {
      expect(CreateJobRequest.parse({ ...validEmailJob, scheduledAt }).scheduledAt).toBe(
        scheduledAt,
      );
    }
  });

  // Only full timestamps with seconds and an offset as `Z` or `±hh:mm` are accepted; `null` is not
  // "no time", leaving the field out is.
  it.each([
    '2026-11-02',
    '2026-11-02T08:30:00',
    '2026-11-02T08:30Z',
    '2026-11-02T08:30:00+0200',
    'tomorrow',
    1793611800000,
    null,
  ])('Execution time is not a timestamp: %s', (scheduledAt) => {
    expect(issuePaths({ ...validEmailJob, scheduledAt })).toEqual([['scheduledAt']]);
  });

  it('Unknown job type', () => {
    const { type: _type, ...withoutType } = validEmailJob;
    const { payload: _payload, ...withoutPayload } = validEmailJob;

    expect(issuePaths({ ...validEmailJob, type: 'fax' })).toContainEqual(['type']);
    expect(issuePaths(withoutType)).toContainEqual(['type']);
    expect(issuePaths(withoutPayload)).toContainEqual(['payload']);
    expect(
      issuePaths({ ...validEmailJob, payload: { method: 'POST', url: 'https://example.com/' } }),
    ).toContainEqual(['payload', 'to']);
  });

  it('Invalid email address', () => {
    for (const to of ['not-an-email', '', undefined]) {
      expect(
        issuePaths({ ...validEmailJob, payload: { ...validEmailJob.payload, to } }),
      ).toContainEqual(['payload', 'to']);
    }
  });

  it('accepts an empty email body', () => {
    const job = { ...validEmailJob, payload: { ...validEmailJob.payload, body: '' } };

    expect(CreateJobRequest.parse(job)).toEqual(job);
  });

  it('Empty subject', () => {
    expect(
      issuePaths({ ...validEmailJob, payload: { ...validEmailJob.payload, subject: '' } }),
    ).toContainEqual(['payload', 'subject']);
  });

  it('Email field too long', () => {
    const subject = 'a'.repeat(EMAIL_LIMITS.subjectMaxLength + 1);
    const body = 'a'.repeat(EMAIL_LIMITS.bodyMaxLength + 1);

    expect(
      issuePaths({ ...validEmailJob, payload: { ...validEmailJob.payload, subject, body } }),
    ).toEqual(
      expect.arrayContaining([
        ['payload', 'subject'],
        ['payload', 'body'],
      ]),
    );
  });

  it('accepts email fields at their maximum length', () => {
    const subject = 'a'.repeat(EMAIL_LIMITS.subjectMaxLength);
    const body = 'a'.repeat(EMAIL_LIMITS.bodyMaxLength);
    const job = { ...validEmailJob, payload: { ...validEmailJob.payload, subject, body } };

    expect(CreateJobRequest.parse(job)).toEqual(job);
  });

  it('Priority out of range', () => {
    for (const priority of [
      JOB_LIMITS.priority.min - 1,
      JOB_LIMITS.priority.max + 1,
      2.5,
      'high',
      null,
    ]) {
      expect(issuePaths({ ...validEmailJob, priority })).toContainEqual(['priority']);
    }
  });

  it('Max attempts out of range', () => {
    for (const maxAttempts of [
      JOB_LIMITS.maxAttempts.min - 1,
      JOB_LIMITS.maxAttempts.max + 1,
      1.5,
      'three',
      null,
    ]) {
      expect(issuePaths({ ...validEmailJob, maxAttempts })).toContainEqual(['maxAttempts']);
    }
  });

  it('accepts priority and max attempts at their limits', () => {
    for (const limit of ['min', 'max'] as const) {
      const job = {
        ...validEmailJob,
        priority: JOB_LIMITS.priority[limit],
        maxAttempts: JOB_LIMITS.maxAttempts[limit],
      };

      expect(CreateJobRequest.parse(job)).toEqual(job);
    }
  });

  it('Single job with a group id', () => {
    const job = { ...validEmailJob, groupId: randomUUID() };

    expect(CreateJobRequest.parse(job)).toEqual(job);
  });

  it('Job without a group id', () => {
    expect(CreateJobRequest.parse(validEmailJob)).not.toHaveProperty('groupId');
  });

  it.each([
    { name: 'not a UUID', groupId: 'campaign-1' },
    { name: 'an empty string', groupId: '' },
    { name: 'null', groupId: null },
  ])('Malformed group id: $name', ({ groupId }) => {
    expect(issuePaths({ ...validEmailJob, groupId })).toEqual([['groupId']]);
  });
});

const validWebhookJob = {
  type: 'webhook',
  payload: {
    method: 'POST',
    url: 'https://hooks.example.com/orders',
    body: { orderId: 'ord_4821', event: 'order.paid' },
  },
  priority: 5,
  maxAttempts: 3,
};

describe('CreateJobRequest for a webhook job', () => {
  const issuePaths = (input: unknown): PropertyKey[][] =>
    CreateJobRequest.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];
  const withPayload = (payload: Record<string, unknown>): unknown => ({
    ...validWebhookJob,
    payload: { ...validWebhookJob.payload, ...payload },
  });

  it('Valid webhook job is accepted', () => {
    expect(CreateJobRequest.parse(validWebhookJob)).toEqual(validWebhookJob);
  });

  it('accepts every allowed method', () => {
    for (const method of WEBHOOK_METHODS) {
      expect(CreateJobRequest.safeParse(withPayload({ method })).success).toBe(true);
    }
  });

  it('Webhook job without a body is accepted', () => {
    const job = { ...validWebhookJob, payload: { method: 'GET', url: 'http://example.com/ping' } };

    expect(CreateJobRequest.parse(job)).toEqual(job);
  });

  it('Method not allowed', () => {
    for (const method of ['DELETE', 'post', '']) {
      expect(issuePaths(withPayload({ method }))).toContainEqual(['payload', 'method']);
    }
  });

  it('URL with another scheme', () => {
    expect(issuePaths(withPayload({ url: 'ftp://example.com/hook' }))).toContainEqual([
      'payload',
      'url',
    ]);
  });

  it('URL missing or not a URL', () => {
    const { url: _url, ...withoutUrl } = validWebhookJob.payload;

    expect(issuePaths({ ...validWebhookJob, payload: withoutUrl })).toContainEqual([
      'payload',
      'url',
    ]);
    for (const url of ['not a url', '/orders']) {
      expect(issuePaths(withPayload({ url }))).toContainEqual(['payload', 'url']);
    }
  });

  it('URL too long', () => {
    const prefix = 'https://example.com/';
    const url = prefix + 'a'.repeat(WEBHOOK_LIMITS.urlMaxLength - prefix.length + 1);

    expect(issuePaths(withPayload({ url }))).toContainEqual(['payload', 'url']);
    expect(CreateJobRequest.safeParse(withPayload({ url: url.slice(0, -1) })).success).toBe(true);
  });

  it('Body is not a JSON object', () => {
    for (const body of [['a'], 'text', null]) {
      expect(issuePaths(withPayload({ body }))).toContainEqual(['payload', 'body']);
    }
  });
});

describe('QueryJobsRequest', () => {
  it('coerces query-string numbers and defaults the offset to zero', () => {
    expect(QueryJobsRequest.parse({ limit: '2' })).toEqual({ limit: 2, offset: 0 });
  });

  it('leaves the limit to the configured default when it is omitted', () => {
    expect(QueryJobsRequest.parse({}).limit).toBeUndefined();
  });

  it('Negative offset', () => {
    for (const offset of ['-1', '1.5', 'abc']) {
      const result = QueryJobsRequest.safeParse({ offset });

      expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(['offset']);
    }
  });

  it('rejects a limit that is not a positive integer', () => {
    for (const limit of ['0', '-3', '1.5', 'many']) {
      const result = QueryJobsRequest.safeParse({ limit });

      expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(['limit']);
    }
  });

  it('leaves both filters unset when they are omitted', () => {
    const query = QueryJobsRequest.parse({});

    expect(query.status).toBeUndefined();
    expect(query.type).toBeUndefined();
  });

  it('Filter by one status', () => {
    expect(QueryJobsRequest.parse({ status: 'failed' }).status).toEqual(['failed']);
  });

  it('Filter by several statuses', () => {
    expect(QueryJobsRequest.parse({ status: ['failed', 'cancelled'] }).status).toEqual([
      'failed',
      'cancelled',
    ]);
  });

  it('Repeated status value', () => {
    expect(QueryJobsRequest.parse({ status: ['failed', 'failed'] }).status).toEqual(['failed']);
  });

  it('Filter by one type', () => {
    expect(QueryJobsRequest.parse({ type: 'webhook' }).type).toEqual(['webhook']);
  });

  it('Filter by several types', () => {
    expect(QueryJobsRequest.parse({ type: ['email', 'webhook', 'email'] }).type).toEqual([
      'email',
      'webhook',
    ]);
  });

  it.each([
    { name: 'Unknown status filter', status: 'done' },
    { name: 'Empty filter value', status: '' },
    { name: 'One unknown value among known ones', status: ['failed', 'done'] },
    { name: 'an empty list', status: [] },
    { name: 'a nested object', status: { in: 'failed' } },
  ])('rejects a status filter: $name', ({ status }) => {
    const result = QueryJobsRequest.safeParse({ status });

    expect(result.error?.issues.map((issue) => issue.path[0])).toContain('status');
  });

  it.each([
    { name: 'Unknown type filter', type: 'sms' },
    { name: 'an empty value', type: '' },
    { name: 'one unknown value among known ones', type: ['email', 'sms'] },
    { name: 'an empty list', type: [] },
    { name: 'a nested object', type: { in: 'email' } },
  ])('rejects a type filter: $name', ({ type }) => {
    const result = QueryJobsRequest.safeParse({ type });

    expect(result.error?.issues.map((issue) => issue.path[0])).toContain('type');
  });

  it('Filter by group', () => {
    const groupId = randomUUID();

    expect(QueryJobsRequest.parse({ groupId }).groupId).toBe(groupId);
  });

  it('leaves the group filter unset when it is omitted', () => {
    expect(QueryJobsRequest.parse({}).groupId).toBeUndefined();
  });

  it.each([
    { name: 'Malformed group id filter', groupId: 'campaign-1' },
    { name: 'an empty value', groupId: '' },
    { name: 'a repeated value', groupId: [randomUUID(), randomUUID()] },
  ])('rejects a group filter: $name', ({ groupId }) => {
    const result = QueryJobsRequest.safeParse({ groupId });

    expect(result.error?.issues.map((issue) => issue.path[0])).toContain('groupId');
  });
});

describe('JobIdParams', () => {
  it('accepts a UUID', () => {
    const id = randomUUID();

    expect(JobIdParams.parse({ id })).toEqual({ id });
  });

  it('Malformed id', () => {
    const result = JobIdParams.safeParse({ id: 'abc' });

    expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(['id']);
  });
});

describe('ChangeJobStatusRequest', () => {
  const statusIssues = (input: unknown): PropertyKey[][] =>
    ChangeJobStatusRequest.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

  it('accepts a cancel and a retry', () => {
    expect(ChangeJobStatusRequest.parse({ status: 'cancelled' })).toEqual({ status: 'cancelled' });
    expect(ChangeJobStatusRequest.parse({ status: 'pending' })).toEqual({ status: 'pending' });
  });

  it('Unsupported target status', () => {
    for (const status of ['completed', 'processing', 'failed', 'scheduled', 'done']) {
      expect(statusIssues({ status })).toEqual([['status']]);
    }
  });

  it('Missing status', () => {
    expect(statusIssues({})).toEqual([['status']]);
  });

  it('rejects a status that is not a string', () => {
    for (const status of [null, 42]) {
      expect(statusIssues({ status })).toEqual([['status']]);
    }
  });

  it('drops fields other than the status', () => {
    expect(
      ChangeJobStatusRequest.parse({ status: 'pending', attempts: 3, error: { code: 'X' } }),
    ).toEqual({ status: 'pending' });
  });
});

describe('UpdateJobRequest', () => {
  it('accepts a start, a completion with a result and a failure with an error', () => {
    expect(UpdateJobRequest.parse({ status: 'processing' })).toEqual({ status: 'processing' });
    expect(UpdateJobRequest.parse({ status: 'completed', result: { messageId: 'm-1' } })).toEqual({
      status: 'completed',
      result: { messageId: 'm-1' },
    });
    expect(
      UpdateJobRequest.parse({
        status: 'failed',
        error: { code: 'SEND_FAILED', message: 'Mailbox unavailable' },
      }),
    ).toEqual({ status: 'failed', error: { code: 'SEND_FAILED', message: 'Mailbox unavailable' } });
  });

  it('Unknown target status', () => {
    for (const status of ['pending', 'cancelled', 'done']) {
      expect(UpdateJobRequest.safeParse({ status }).success).toBe(false);
    }
  });

  it('rejects a report without a status', () => {
    expect(UpdateJobRequest.safeParse({}).success).toBe(false);
  });

  it('rejects a failure without an error, or with an error without a code', () => {
    expect(UpdateJobRequest.safeParse({ status: 'failed' }).success).toBe(false);
    expect(UpdateJobRequest.safeParse({ status: 'failed', error: { message: 'x' } }).success).toBe(
      false,
    );
  });

  it('rejects a completion without a result', () => {
    expect(UpdateJobRequest.safeParse({ status: 'completed' }).success).toBe(false);
  });
});

describe('EmailJobResult', () => {
  it('accepts a message id', () => {
    expect(EmailJobResult.parse({ messageId: 'm-1' })).toEqual({ messageId: 'm-1' });
  });

  it('Result does not match the job type', () => {
    expect(EmailJobResult.safeParse({ id: 'm-1' }).success).toBe(false);
    expect(EmailJobResult.safeParse({ messageId: '' }).success).toBe(false);
  });
});

describe('WebhookJobResult', () => {
  it('Webhook result is stored', () => {
    for (const statusCode of [200, 299]) {
      const result = { statusCode, responseBody: { received: true } };

      expect(WebhookJobResult.parse(result)).toEqual(result);
    }
  });

  it('Webhook result does not match', () => {
    for (const result of [
      { responseBody: {} },
      { statusCode: 404, responseBody: {} },
      { statusCode: 199, responseBody: {} },
      { statusCode: 300, responseBody: {} },
      { statusCode: 503, responseBody: {} },
      { statusCode: 200, responseBody: ['a'] },
      { statusCode: 200, responseBody: 'ok' },
    ]) {
      expect(WebhookJobResult.safeParse(result).success).toBe(false);
    }
  });
});

describe('Job', () => {
  it('Failed webhook error is returned with its status code', () => {
    const timestamp = new Date().toISOString();
    const job = {
      id: randomUUID(),
      type: 'webhook',
      status: 'failed',
      priority: 5,
      attempts: 3,
      maxAttempts: 3,
      payload: validWebhookJob.payload,
      result: null,
      error: {
        code: 'WEBHOOK_HTTP_ERROR',
        message: 'HTTP 503 Service Unavailable',
        details: { statusCode: 503 },
      },
      groupId: null,
      scheduledAt: null,
      startedAt: timestamp,
      completedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(Job.parse(job)).toEqual(job);
  });

  it('returns the execution time of a scheduled job in UTC only', () => {
    const timestamp = new Date().toISOString();
    const job = {
      id: randomUUID(),
      type: 'email',
      status: 'scheduled',
      priority: 5,
      attempts: 0,
      maxAttempts: 3,
      payload: validEmailJob.payload,
      result: null,
      error: null,
      groupId: null,
      scheduledAt: '2026-11-02T08:30:00.000Z',
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    expect(Job.parse(job)).toEqual(job);
    expect(
      Job.safeParse({ ...job, scheduledAt: '2026-11-02T10:30:00.000+02:00' }).error?.issues.map(
        (issue) => issue.path,
      ),
    ).toEqual([['scheduledAt']]);
  });

  it('returns the group id of a job in a group, and requires the field', () => {
    const timestamp = new Date().toISOString();
    const job = {
      id: randomUUID(),
      type: 'email',
      status: 'pending',
      priority: 5,
      attempts: 0,
      maxAttempts: 3,
      payload: validEmailJob.payload,
      result: null,
      error: null,
      groupId: randomUUID(),
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const { groupId: _groupId, ...withoutGroupId } = job;

    expect(Job.parse(job)).toEqual(job);
    expect(Job.safeParse(withoutGroupId).error?.issues.map((issue) => issue.path)).toEqual([
      ['groupId'],
    ]);
    expect(
      Job.safeParse({ ...job, groupId: 'campaign-1' }).error?.issues.map((issue) => issue.path),
    ).toEqual([['groupId']]);
  });
});

const validTransitJob = {
  type: 'flight-transit',
  payload: { origin: 'LHR', destination: 'JFK', departureDate: '2030-06-15' },
  priority: 5,
  maxAttempts: 3,
};

const validTransitReport = {
  flight: 'BA117',
  aircraft: { model: 'Boeing 777-300ER', registration: 'G-STBA' },
  origin: {
    iata: 'LHR',
    name: 'Heathrow Airport',
    city: 'London',
    timeZone: 'Europe/London',
    lat: 51.47,
    lon: -0.4543,
  },
  destination: {
    iata: 'JFK',
    name: 'John F. Kennedy International Airport',
    city: 'New York',
    timeZone: 'America/New_York',
    lat: 40.6413,
    lon: -73.7781,
  },
  departureAt: '2030-06-15T08:20:00.000Z',
  arrivalAt: '2030-06-15T16:05:00.000Z',
  distanceKm: 5555,
  durationMin: 465,
  cruiseAltitudeFt: 37000,
  path: [
    [51.47, -0.4543],
    [52.1, -40.5],
    [40.6413, -73.7781],
  ],
  waypoints: [
    {
      name: 'Departure',
      at: '2030-06-15T08:20:00.000Z',
      lat: 51.47,
      lon: -0.4543,
      altitudeFt: 0,
      groundSpeedKmh: 0,
      distanceFlownKm: 0,
    },
    {
      name: 'Arrival',
      at: '2030-06-15T16:05:00.000Z',
      lat: 40.6413,
      lon: -73.7781,
      altitudeFt: 0,
      groundSpeedKmh: 0,
      distanceFlownKm: 5555,
    },
  ],
};

describe('CreateJobRequest for a flight transit job', () => {
  const issuePaths = (input: unknown): PropertyKey[][] =>
    CreateJobRequest.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];
  const withPayload = (payload: Record<string, unknown>): unknown => ({
    ...validTransitJob,
    payload: { ...validTransitJob.payload, ...payload },
  });

  it('Valid flight transit job is accepted', () => {
    expect(CreateJobRequest.parse(validTransitJob)).toEqual(validTransitJob);
  });

  it('Unknown airport code', () => {
    expect(issuePaths(withPayload({ origin: 'XXX' }))).toEqual([['payload', 'origin']]);
  });

  it('Lower-case airport code', () => {
    expect(issuePaths(withPayload({ destination: 'jfk' }))).toEqual([['payload', 'destination']]);
  });

  it('Same airport twice', () => {
    expect(issuePaths(withPayload({ destination: 'LHR' }))).toEqual([['payload', 'destination']]);
  });

  it('Missing payload fields', () => {
    expect(issuePaths({ ...validTransitJob, payload: {} })).toEqual([
      ['payload', 'origin'],
      ['payload', 'destination'],
      ['payload', 'departureDate'],
    ]);
  });

  it('Airport code of the wrong form', () => {
    for (const origin of ['LH', 'LHRX', '', 123]) {
      expect(issuePaths(withPayload({ origin }))).toEqual([['payload', 'origin']]);
    }
  });

  it('Departure date is not a calendar date', () => {
    for (const departureDate of [
      '2026-02-30',
      '2025-02-29',
      '30/10/2026',
      '2030-06-15T08:00:00.000Z',
      '',
      null,
      20300615,
    ]) {
      expect(issuePaths(withPayload({ departureDate }))).toEqual([['payload', 'departureDate']]);
    }
  });

  it('accepts a leap day', () => {
    expect(CreateJobRequest.safeParse(withPayload({ departureDate: '2028-02-29' })).success).toBe(
      true,
    );
  });
});

describe('FlightTransitJobResult', () => {
  it('Transit report is stored', () => {
    expect(FlightTransitJobResult.parse(validTransitReport)).toEqual(validTransitReport);
  });

  it('Report for other airports than the payload is stored', () => {
    const report = {
      ...validTransitReport,
      origin: { ...validTransitReport.origin, iata: 'CDG' },
    };

    expect(FlightTransitJobResult.parse(report)).toEqual(report);
  });

  it('Transit report does not match', () => {
    const { aircraft: _aircraft, ...withoutAircraft } = validTransitReport;
    const [departure, arrival] = validTransitReport.waypoints as [
      (typeof validTransitReport.waypoints)[number],
      (typeof validTransitReport.waypoints)[number],
    ];
    const { at: _at, ...waypointWithoutAt } = departure;
    const { distanceFlownKm: _flown, ...waypointWithoutDistance } = departure;
    const { timeZone: _timeZone, ...originWithoutTimeZone } = validTransitReport.origin;
    const report = (changes: Record<string, unknown>): unknown => ({
      ...validTransitReport,
      ...changes,
    });
    const issuePaths = (input: unknown): PropertyKey[][] =>
      FlightTransitJobResult.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

    const cases: [unknown, PropertyKey[]][] = [
      [report({ flight: undefined }), ['flight']],
      [report({ flight: '' }), ['flight']],
      [report({ destination: undefined }), ['destination']],
      [report({ aircraft: { registration: 'G-STBA' } }), ['aircraft', 'model']],
      [report({ distanceKm: '5555' }), ['distanceKm']],
      [report({ path: [] }), ['path']],
      [
        report({ waypoints: [{ ...departure, name: undefined }, arrival] }),
        ['waypoints', 0, 'name'],
      ],
      [report({ waypoints: [{ ...departure, lat: undefined }, arrival] }), ['waypoints', 0, 'lat']],
      [
        report({ waypoints: [{ ...departure, altitudeFt: undefined }, arrival] }),
        ['waypoints', 0, 'altitudeFt'],
      ],
      [
        report({ waypoints: [{ ...departure, groundSpeedKmh: undefined }, arrival] }),
        ['waypoints', 0, 'groundSpeedKmh'],
      ],
      [withoutAircraft, ['aircraft']],
      [report({ aircraft: { model: 'Boeing 777' } }), ['aircraft', 'registration']],
      [report({ origin: { ...validTransitReport.origin, lat: 91 } }), ['origin', 'lat']],
      [report({ origin: { ...validTransitReport.origin, iata: 'lhr' } }), ['origin', 'iata']],
      [report({ origin: originWithoutTimeZone }), ['origin', 'timeZone']],
      [
        report({ destination: { ...validTransitReport.destination, lon: -181 } }),
        ['destination', 'lon'],
      ],
      [report({ distanceKm: -1 }), ['distanceKm']],
      [report({ durationMin: -1 }), ['durationMin']],
      [report({ cruiseAltitudeFt: -1 }), ['cruiseAltitudeFt']],
      [report({ departureAt: 'tomorrow' }), ['departureAt']],
      [report({ arrivalAt: '2030-06-15' }), ['arrivalAt']],
      [report({ path: [[51.47, -0.4543]] }), ['path']],
      [
        report({
          path: [
            [91, 0],
            [0, 0],
          ],
        }),
        ['path', 0, 0],
      ],
      [
        report({
          path: [
            [0, 0],
            [0, 181],
          ],
        }),
        ['path', 1, 1],
      ],
      [
        report({
          path: [
            [0, -181],
            [0, 0],
          ],
        }),
        ['path', 0, 1],
      ],
      [
        report({
          path: [
            [0, 0, 0],
            [0, 0],
          ],
        }),
        ['path', 0],
      ],
      [report({ waypoints: [departure] }), ['waypoints']],
      [report({ waypoints: [{ ...departure, lat: -91 }, arrival] }), ['waypoints', 0, 'lat']],
      [report({ waypoints: [departure, { ...arrival, lon: 181 }] }), ['waypoints', 1, 'lon']],
      [
        report({ waypoints: [{ ...departure, altitudeFt: -1 }, arrival] }),
        ['waypoints', 0, 'altitudeFt'],
      ],
      [
        report({ waypoints: [{ ...departure, groundSpeedKmh: -1 }, arrival] }),
        ['waypoints', 0, 'groundSpeedKmh'],
      ],
      [
        report({ waypoints: [departure, { ...arrival, distanceFlownKm: -1 }] }),
        ['waypoints', 1, 'distanceFlownKm'],
      ],
      [report({ waypoints: [waypointWithoutAt, arrival] }), ['waypoints', 0, 'at']],
      [report({ waypoints: [{ ...departure, at: 'noon' }, arrival] }), ['waypoints', 0, 'at']],
      [
        report({ waypoints: [waypointWithoutDistance, arrival] }),
        ['waypoints', 0, 'distanceFlownKm'],
      ],
    ];
    for (const [input, path] of cases) {
      expect(issuePaths(input)).toEqual([path]);
    }
  });
});

describe('Job for a flight transit job', () => {
  const timestamp = new Date().toISOString();
  const base = {
    id: randomUUID(),
    type: 'flight-transit',
    priority: 5,
    maxAttempts: 3,
    payload: validTransitJob.payload,
    groupId: null,
    scheduledAt: null,
    startedAt: timestamp,
    completedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  it('parses a completed transit job with its report', () => {
    const job = {
      ...base,
      status: 'completed',
      attempts: 1,
      result: validTransitReport,
      error: null,
    };

    expect(Job.parse(job)).toEqual(job);
  });

  it("rejects a transit job with another type's result or payload", () => {
    const completed = { ...base, status: 'completed', attempts: 1, error: null };
    const issuePaths = (input: unknown): PropertyKey[][] =>
      Job.safeParse(input).error?.issues.map((issue) => issue.path.slice(0, 1)) ?? [];

    expect(
      issuePaths({ ...completed, result: { statusCode: 200, responseBody: {} } }),
    ).toContainEqual(['result']);
    expect(
      issuePaths({
        ...completed,
        result: validTransitReport,
        payload: { to: 'ada@example.com', subject: 'Hi', body: 'Hi' },
      }),
    ).toContainEqual(['payload']);
  });

  it('Failed transit error is returned as sent', () => {
    const job = {
      ...base,
      status: 'failed',
      attempts: 3,
      result: null,
      error: { code: 'TRANSIT_GENERATION_FAILED', message: 'No route', details: { origin: 'LHR' } },
    };

    expect(Job.parse(job)).toEqual(job);
  });
});

describe('CreateJobsBulkRequest', () => {
  const issuePaths = (input: unknown): PropertyKey[][] =>
    CreateJobsBulkRequest.safeParse(input).error?.issues.map((issue) => issue.path) ?? [];

  it('accepts jobs of every type and keeps their order', () => {
    const jobs = [validEmailJob, validWebhookJob, validTransitJob];

    expect(CreateJobsBulkRequest.parse({ jobs })).toEqual({ jobs });
  });

  it('Defaults are applied to each item', () => {
    const { priority: _priority, maxAttempts: _maxAttempts, ...withoutOptions } = validEmailJob;

    const { jobs } = CreateJobsBulkRequest.parse({ jobs: [withoutOptions, withoutOptions] });

    for (const job of jobs) {
      expect(job.priority).toBe(JOB_LIMITS.priority.default);
      expect(job.maxAttempts).toBe(JOB_LIMITS.maxAttempts.default);
    }
  });

  it('Bulk items with a group id', () => {
    const groupId = randomUUID();
    const jobs = [
      { ...validEmailJob, groupId },
      { ...validWebhookJob, groupId },
    ];

    expect(CreateJobsBulkRequest.parse({ jobs })).toEqual({ jobs });
  });

  it('Empty bulk', () => {
    expect(issuePaths({ jobs: [] })).toEqual([['jobs']]);
  });

  it.each([
    { name: 'no jobs field', body: {}, path: ['jobs'] },
    { name: 'a bare array', body: [validEmailJob], path: [] },
    { name: 'jobs that is not an array', body: { jobs: validEmailJob }, path: ['jobs'] },
  ])('rejects a body with $name', ({ body, path }) => {
    expect(issuePaths(body)).toEqual([path]);
  });

  it('One item with an invalid payload', () => {
    const invalid = { ...validEmailJob, payload: { ...validEmailJob.payload, to: 'not-an-email' } };

    expect(issuePaths({ jobs: [validEmailJob, invalid] })).toEqual([['jobs', 1, 'payload', 'to']]);
  });

  it('Unknown job type in one item', () => {
    const unknown = { ...validEmailJob, type: 'sms' };

    expect(issuePaths({ jobs: [validEmailJob, validWebhookJob, unknown] })).toEqual([
      ['jobs', 2, 'type'],
    ]);
  });

  it('names the position of every invalid item', () => {
    const invalidPriority = { ...validEmailJob, priority: JOB_LIMITS.priority.max + 1 };
    const malformedGroup = { ...validWebhookJob, groupId: 'campaign-1' };

    expect(issuePaths({ jobs: [invalidPriority, validEmailJob, malformedGroup] })).toEqual([
      ['jobs', 0, 'priority'],
      ['jobs', 2, 'groupId'],
    ]);
  });
});
