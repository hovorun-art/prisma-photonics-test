import { expect, test } from '@playwright/test';

import { stack } from './support/running-stack.js';
import { EXECUTION_INSTANCES } from './support/stack-settings.js';

const SERVICE = 'job-execution-service';

test('Instances scaled: both execution instances are healthy', async () => {
  const { containers } = await stack.containers({ service: SERVICE });

  expect(containers).toHaveLength(EXECUTION_INSTANCES);
  for (const container of containers) {
    expect(container).toMatchObject({ state: 'running', health: 'healthy' });
  }
});

test('Instance started: each execution instance logged that it started, under its own instance id', async () => {
  const { lines } = await stack.logs({ service: SERVICE });

  const started = lines
    .map((line) => JSON.parse(line) as { msg?: string; instanceId?: string })
    .filter((entry) => entry.msg?.includes('job-execution-service started') === true);
  expect(started).toHaveLength(EXECUTION_INSTANCES);
  expect(new Set(started.map((entry) => entry.instanceId)).size).toBe(EXECUTION_INSTANCES);
});
