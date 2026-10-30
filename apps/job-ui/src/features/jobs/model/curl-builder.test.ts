import { describe, expect, it } from 'vitest';

import { CurlBuilder } from './curl-builder';

const curl = new CurlBuilder({ apiBaseUrl: 'http://localhost:8080/api' });

describe('CurlBuilder', () => {
  it('submit: a POST of the request as JSON to the jobs route', () => {
    const request = {
      type: 'email' as const,
      payload: { to: 'ops@acme.test', subject: 'Hi', body: 'Hello' },
      priority: 5,
      maxAttempts: 3,
    };

    expect(curl.submit({ request }).command).toBe(
      [
        'curl -X POST http://localhost:8080/api/v1/jobs \\',
        "  -H 'Content-Type: application/json' \\",
        `  -d '${JSON.stringify(request, null, 2)}'`,
      ].join('\n'),
    );
  });

  it('submit: single quotes in the body are escaped for the shell', () => {
    const request = {
      type: 'email' as const,
      payload: { to: 'ops@acme.test', subject: "It's done", body: '' },
      priority: 5,
      maxAttempts: 3,
    };

    expect(curl.submit({ request }).command).toContain(`It'\\''s done`);
  });

  it('get: a GET of the job route', () => {
    expect(curl.get({ id: '7f3a9c21-4b5d-4e6f-8a7b-9c0d1e2f3a4b' }).command).toBe(
      'curl http://localhost:8080/api/v1/jobs/7f3a9c21-4b5d-4e6f-8a7b-9c0d1e2f3a4b',
    );
  });
});
