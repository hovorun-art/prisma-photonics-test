import { test as teardown } from '@playwright/test';

import { stack } from './support/running-stack.js';

teardown('remove the compose stack and its volumes', async () => {
  await stack.down();
});
