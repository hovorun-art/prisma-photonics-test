import type { Random } from '@job-queue/kernel';
import { describe, expect, it, vi } from 'vitest';

import { HostnameInstanceIdFactory } from './hostname-instance-id-factory.js';

describe('HostnameInstanceIdFactory', () => {
  it('combines the host name with a random suffix', () => {
    const digits = [0, 18, 35, 0, 18, 35];
    const int = vi.fn<Random['int']>(() => ({ value: digits.shift() ?? 0 }));
    const random: Random = { next: vi.fn(), int };

    const { instanceId } = new HostnameInstanceIdFactory({ random }).create({
      hostname: 'worker-host',
    });

    expect(instanceId).toBe('worker-host-0iz0iz');
    expect(int).toHaveBeenCalledWith({ min: 0, max: 35 });
  });

  it('gives two instances on the same host different ids', () => {
    let calls = 0;
    const random: Random = {
      next: vi.fn(),
      int: () => ({ value: (calls += 1) % 36 }),
    };
    const factory = new HostnameInstanceIdFactory({ random });

    expect(factory.create({ hostname: 'host' }).instanceId).not.toBe(
      factory.create({ hostname: 'host' }).instanceId,
    );
  });

  it('turns characters that are unsafe in logs and keys into dashes', () => {
    const random: Random = { next: vi.fn(), int: () => ({ value: 0 }) };

    expect(
      new HostnameInstanceIdFactory({ random }).create({ hostname: ' My Host.local ' }).instanceId,
    ).toBe('my-host-local-000000');
  });

  it('falls back to a generic prefix when the host name is empty', () => {
    const random: Random = { next: vi.fn(), int: () => ({ value: 0 }) };

    expect(new HostnameInstanceIdFactory({ random }).create({ hostname: '' }).instanceId).toBe(
      'execution-000000',
    );
  });
});
