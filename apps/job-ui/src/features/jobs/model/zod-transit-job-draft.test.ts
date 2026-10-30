import type { Clock } from '@job-queue/kernel';
import { JOB_LIMITS } from '@job-queue/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';

import { en } from '@/locales';

import type { TransitFormValues } from './transit-form-values';
import { ZodTransitJobDraft } from './zod-transit-job-draft';

const clock = mockDeep<Clock>();
const draft = new ZodTransitJobDraft({ clock });
const schema = draft.schema().schema;
const EXECUTION = { priority: 7, maxAttempts: 4 };
/** Late evening in UTC: in time zones east of UTC it is already the next day. */
const NOW = new Date('2026-10-30T23:30:00.000Z');
const TODAY = '2026-10-30';
const VALID: TransitFormValues = {
  type: 'flight-transit',
  payload: { origin: 'LHR', destination: 'JFK', departureDate: TODAY },
  ...EXECUTION,
};

describe('ZodTransitJobDraft', () => {
  // East of UTC, `NOW` is already the next local day: a local-date "today" would fail these tests.
  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });
  afterAll(() => {
    process.env.TZ = 'UTC';
  });
  beforeEach(() => {
    mockReset(clock);
  });

  it("Transit form at first: no airports, today's UTC date, the given execution", () => {
    clock.now.mockReturnValueOnce({ now: NOW });

    expect(draft.emptyValues({ execution: EXECUTION }).values).toEqual({
      type: 'flight-transit',
      payload: { origin: '', destination: '', departureDate: TODAY },
      ...EXECUTION,
    });
  });

  it('Submit a valid transit job: the values become the request as they are', () => {
    clock.now.mockReturnValueOnce({ now: NOW });

    const result = schema.safeParse(VALID);

    expect(result.success && result.data).toEqual(VALID);
  });

  it('a later departure date is accepted', () => {
    clock.now.mockReturnValueOnce({ now: NOW });

    const result = schema.safeParse({
      ...VALID,
      payload: { ...VALID.payload, departureDate: '2026-12-01' },
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ['Missing airport (destination)', { destination: '' }, ['payload.destination']],
    ['Departure date in the past', { departureDate: '2026-10-29' }, ['payload.departureDate']],
    [
      'Missing airport and a past date',
      { origin: '', departureDate: '2026-10-29' },
      ['payload.origin', 'payload.departureDate'],
    ],
  ] as const)('%s is rejected on its field', (_name, payload, expected) => {
    clock.now.mockReturnValueOnce({ now: NOW });

    const result = schema.safeParse({ ...VALID, payload: { ...VALID.payload, ...payload } });

    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(expected);
  });

  it('fieldMessage: a missing origin asks to choose one', () => {
    const values = { ...VALID, payload: { ...VALID.payload, origin: '' as const } };

    expect(draft.fieldMessage({ field: 'payload.origin', values }).message).toBe(
      en.submit.errors.originRequired,
    );
  });

  it('fieldMessage: tells a missing destination from the same airport twice', () => {
    const missing = { ...VALID, payload: { ...VALID.payload, destination: '' as const } };
    const same = { ...VALID, payload: { ...VALID.payload, destination: 'LHR' as const } };

    expect(draft.fieldMessage({ field: 'payload.destination', values: missing }).message).toBe(
      en.submit.errors.destinationRequired,
    );
    expect(draft.fieldMessage({ field: 'payload.destination', values: same }).message).toBe(
      en.submit.errors.sameAirport,
    );
  });

  it("fieldMessage: tells a date that is no real date from a past one, naming today's UTC date", () => {
    const invalid = { ...VALID, payload: { ...VALID.payload, departureDate: '2026-02-30' } };
    const past = { ...VALID, payload: { ...VALID.payload, departureDate: '2026-10-29' } };
    clock.now.mockReturnValueOnce({ now: NOW });

    expect(draft.fieldMessage({ field: 'payload.departureDate', values: invalid }).message).toBe(
      en.submit.errors.departureDate,
    );
    expect(draft.fieldMessage({ field: 'payload.departureDate', values: past }).message).toBe(
      en.submit.errors.departureDatePast(TODAY),
    );
  });

  it("fieldMessage: job-ui's own messages for the execution fields", () => {
    expect(draft.fieldMessage({ field: 'priority', values: VALID }).message).toBe(
      en.submit.errors.priority(JOB_LIMITS.priority.min, JOB_LIMITS.priority.max),
    );
    expect(draft.fieldMessage({ field: 'maxAttempts', values: VALID }).message).toBe(
      en.submit.errors.maxAttempts(JOB_LIMITS.maxAttempts.min, JOB_LIMITS.maxAttempts.max),
    );
  });

  it('API validation error on a transit field: the issue maps onto the departure date field', () => {
    const result = draft.apiErrors({
      details: {
        issues: [{ path: ['payload', 'departureDate'], message: 'Departure day is over' }],
      },
    });

    expect(result).toEqual({
      errors: { 'payload.departureDate': 'Departure day is over' },
      unmatched: [],
    });
  });

  it('Preview of a transit request: the payload is shown as chosen, empty airports included', () => {
    const partial = { ...VALID, payload: { ...VALID.payload, destination: '' as const } };

    expect(draft.previewRequest({ values: VALID }).request).toEqual(VALID);
    expect(draft.previewRequest({ values: partial }).request.payload).toEqual({
      origin: 'LHR',
      destination: '',
      departureDate: TODAY,
    });
  });
});
