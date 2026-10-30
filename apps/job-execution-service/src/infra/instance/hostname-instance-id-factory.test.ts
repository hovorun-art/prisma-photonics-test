import type { Random } from '@job-queue/kernel';
import { describe, expect, it } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';

import { HostnameInstanceIdFactory } from './hostname-instance-id-factory.js';

/** The id suffix has this many random characters, one `random.int` call each. */
const SUFFIX_LENGTH = 6;

describe('HostnameInstanceIdFactory', () => {
  /** A Random whose next `int` calls return these values, in order. */
  const randomReturning = (values: number[]): Random => {
    const random = mockDeep<Random>();
    for (const value of values) random.int.mockReturnValueOnce({ value });
    return random;
  };

  it('combines the host name with a random suffix', () => {
    const random = randomReturning([0, 18, 35, 0, 18, 35]);

    const { instanceId } = new HostnameInstanceIdFactory({ random }).create({
      hostname: 'worker-host',
    });

    expect(instanceId).toBe('worker-host-0iz0iz');
    expect(random.int).toHaveBeenCalledWith({ min: 0, max: 35 });
  });

  it('gives two instances on the same host different ids', () => {
    const random = randomReturning([
      ...Array<number>(SUFFIX_LENGTH).fill(1),
      ...Array<number>(SUFFIX_LENGTH).fill(2),
    ]);
    const factory = new HostnameInstanceIdFactory({ random });

    expect(factory.create({ hostname: 'host' }).instanceId).not.toBe(
      factory.create({ hostname: 'host' }).instanceId,
    );
  });

  it('turns characters that are unsafe in logs and keys into dashes', () => {
    const random = randomReturning(Array<number>(SUFFIX_LENGTH).fill(0));

    expect(
      new HostnameInstanceIdFactory({ random }).create({ hostname: ' My Host.local ' }).instanceId,
    ).toBe('my-host-local-000000');
  });

  it('falls back to a generic prefix when the host name is empty', () => {
    const random = randomReturning(Array<number>(SUFFIX_LENGTH).fill(0));

    expect(new HostnameInstanceIdFactory({ random }).create({ hostname: '' }).instanceId).toBe(
      'execution-000000',
    );
  });
});
