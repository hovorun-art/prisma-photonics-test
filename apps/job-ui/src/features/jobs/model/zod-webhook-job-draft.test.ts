import { JOB_LIMITS, WEBHOOK_LIMITS, WEBHOOK_METHODS } from '@job-queue/contracts';
import { describe, expect, it } from 'vitest';

import { en } from '@/locales';

import type { WebhookFormValues } from './webhook-form-values';
import { ZodWebhookJobDraft } from './zod-webhook-job-draft';

const draft = new ZodWebhookJobDraft();
const schema = draft.schema().schema;
const EXECUTION = { priority: 7, maxAttempts: 4 };
const URL = 'https://hooks.example.com/orders';
const TOO_LONG_URL = `https://e.com/${'a'.repeat(WEBHOOK_LIMITS.urlMaxLength)}`;
const VALID: WebhookFormValues = {
  type: 'webhook',
  payload: { method: 'POST', url: URL, body: '' },
  ...EXECUTION,
};

describe('ZodWebhookJobDraft', () => {
  it('Webhook form at first: method POST, empty URL and body, the given execution', () => {
    expect(draft.emptyValues({ execution: EXECUTION }).values).toEqual({
      type: 'webhook',
      payload: { method: 'POST', url: '', body: '' },
      ...EXECUTION,
    });
  });

  it('Submit a valid webhook job: the body text becomes a JSON object in the request', () => {
    const result = schema.safeParse({
      ...VALID,
      payload: { method: 'PUT', url: URL, body: '{"orderId": "o-1"}' },
    });

    expect(result.success && result.data).toEqual({
      type: 'webhook',
      payload: { method: 'PUT', url: URL, body: { orderId: 'o-1' } },
      ...EXECUTION,
    });
  });

  it.each(['', '   \n'])('Submit without a body: blank text %j sends no body', (body) => {
    const result = schema.safeParse({ ...VALID, payload: { ...VALID.payload, body } });

    expect(result.success && result.data.payload).toEqual({ method: 'POST', url: URL });
  });

  it.each([
    ['Invalid webhook URL', 'ftp://example.com/hook'],
    ['Missing webhook URL', ''],
    ['URL that is not absolute', 'hooks/orders'],
    ['URL too long', TOO_LONG_URL],
  ])('%s is rejected on the URL field', (_name, url) => {
    const result = schema.safeParse({ ...VALID, payload: { ...VALID.payload, url } });

    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['payload.url']);
  });

  it.each([
    ['Body is not valid JSON', '{ orderId: '],
    ['Body is not a JSON object', '[1, 2]'],
    ['Body is a JSON string', '"text"'],
  ])('%s is rejected on the body field', (_name, body) => {
    const result = schema.safeParse({ ...VALID, payload: { ...VALID.payload, body } });

    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['payload.body']);
  });

  it('fieldMessage: tells a bad URL from a too long one', () => {
    const bad = { ...VALID, payload: { ...VALID.payload, url: 'x' } };
    const long = { ...VALID, payload: { ...VALID.payload, url: TOO_LONG_URL } };

    expect(draft.fieldMessage({ field: 'payload.url', values: bad }).message).toBe(
      en.submit.errors.url,
    );
    expect(draft.fieldMessage({ field: 'payload.url', values: long }).message).toBe(
      en.submit.errors.urlTooLong(WEBHOOK_LIMITS.urlMaxLength),
    );
  });

  it('fieldMessage: tells invalid JSON from JSON that is not an object', () => {
    const invalid = { ...VALID, payload: { ...VALID.payload, body: '{ orderId: ' } };
    const array = { ...VALID, payload: { ...VALID.payload, body: '[1]' } };

    expect(draft.fieldMessage({ field: 'payload.body', values: invalid }).message).toBe(
      en.submit.errors.jsonInvalid,
    );
    expect(draft.fieldMessage({ field: 'payload.body', values: array }).message).toBe(
      en.submit.errors.jsonNotObject,
    );
  });

  it("fieldMessage: job-ui's own messages for method and the execution fields", () => {
    expect(draft.fieldMessage({ field: 'payload.method', values: VALID }).message).toBe(
      en.submit.errors.method(WEBHOOK_METHODS.join(', ')),
    );
    expect(draft.fieldMessage({ field: 'priority', values: VALID }).message).toBe(
      en.submit.errors.priority(JOB_LIMITS.priority.min, JOB_LIMITS.priority.max),
    );
    expect(draft.fieldMessage({ field: 'maxAttempts', values: VALID }).message).toBe(
      en.submit.errors.maxAttempts(JOB_LIMITS.maxAttempts.min, JOB_LIMITS.maxAttempts.max),
    );
  });

  it('API validation error on a webhook field: the issue maps onto the URL field', () => {
    const result = draft.apiErrors({
      details: { issues: [{ path: ['payload', 'url'], message: 'Invalid URL' }] },
    });

    expect(result).toEqual({ errors: { 'payload.url': 'Invalid URL' }, unmatched: [] });
  });

  it('Preview of a webhook request: a valid JSON object body is shown parsed', () => {
    const values = { ...VALID, payload: { ...VALID.payload, body: '{"a": 1}' } };

    expect(draft.previewRequest({ values }).request).toEqual({
      type: 'webhook',
      payload: { method: 'POST', url: URL, body: { a: 1 } },
      ...EXECUTION,
    });
  });

  it('Preview of a webhook request: a blank body is left out, other text is shown as typed', () => {
    const typing = { ...VALID, payload: { ...VALID.payload, body: '{ a' } };

    expect(draft.previewRequest({ values: VALID }).request.payload).toEqual({
      method: 'POST',
      url: URL,
    });
    expect(draft.previewRequest({ values: typing }).request.payload).toEqual({
      method: 'POST',
      url: URL,
      body: '{ a',
    });
  });
});
