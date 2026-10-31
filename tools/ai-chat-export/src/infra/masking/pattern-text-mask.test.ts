import { describe, expect, it } from 'vitest';

import { PatternTextMask } from './pattern-text-mask.js';

describe('PatternTextMask', () => {
  const mask = new PatternTextMask({ homeDir: '/Users/someone', email: 'someone@example.com' });

  it('masks the home path, the email and secret-shaped text, and keeps dev tokens', () => {
    const jwt = `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(20)}.${'c'.repeat(20)}`;
    const text = [
      'cd /Users/someone/Dev/repo',
      'git user someone@example.com',
      `key sk-ant-${'x'.repeat(30)}`,
      `token ghp_${'y'.repeat(36)}`,
      `aws AKIA${'Z'.repeat(16)}`,
      `jwt ${jwt}`,
      '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
      'INTERNAL_SERVICE_TOKEN=change-me-local-dev-token e2e-service-token',
    ].join('\n');

    expect(mask.mask({ text }).text).toBe(
      [
        'cd ~/Dev/repo',
        'git user <email>',
        'key <redacted>',
        'token <redacted>',
        'aws <redacted>',
        'jwt <redacted>',
        '<redacted>',
        'INTERNAL_SERVICE_TOKEN=change-me-local-dev-token e2e-service-token',
      ].join('\n'),
    );
  });
});
