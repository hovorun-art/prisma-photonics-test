import { describe, expect, it, vi } from 'vitest';

import {
  PgStatActivityConnectionCounter,
  type PostgresContainerShell,
} from './pg-stat-activity-connection-counter.js';

describe('PgStatActivityConnectionCounter', () => {
  it('counts the connections under an application name through psql', async () => {
    const exec = vi.fn<PostgresContainerShell['exec']>().mockResolvedValueOnce({
      output: ' 3\n',
      exitCode: 0,
    });
    const postgres: PostgresContainerShell = {
      exec,
      getUsername: () => 'user',
      getDatabase: () => 'db',
    };

    const result = await new PgStatActivityConnectionCounter({ postgres }).count({ name: 'app' });

    expect(result).toEqual({ connections: 3 });
    const command = exec.mock.calls[0]?.[0] ?? [];
    expect(command).toEqual(expect.arrayContaining(['-U', 'user', '-d', 'db']));
    expect(command.at(-1)).toContain("application_name = 'app'");
  });

  it('fails when psql fails', async () => {
    const postgres: PostgresContainerShell = {
      exec: vi.fn<PostgresContainerShell['exec']>().mockResolvedValueOnce({
        output: 'boom',
        exitCode: 2,
      }),
      getUsername: () => 'user',
      getDatabase: () => 'db',
    };

    await expect(
      new PgStatActivityConnectionCounter({ postgres }).count({ name: 'app' }),
    ).rejects.toThrow('psql failed');
  });
});
