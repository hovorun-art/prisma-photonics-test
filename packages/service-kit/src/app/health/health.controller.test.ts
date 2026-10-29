import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('answers ok with no probes and no dependencies', () => {
    expect(new HealthController().health()).toEqual({ status: 'ok' });
  });
});
