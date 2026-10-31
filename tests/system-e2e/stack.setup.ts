import { test as setup } from '@playwright/test';

import { stack } from './support/running-stack.js';
import { EXECUTION_INSTANCES } from './support/stack-settings.js';

const BUILD_AND_START_TIMEOUT_MS = 15 * 60_000;

setup('start the compose stack with several execution instances', async () => {
  setup.setTimeout(BUILD_AND_START_TIMEOUT_MS);
  await stack.down();
  await stack.up({ scale: { 'job-execution-service': EXECUTION_INSTANCES } });
});
