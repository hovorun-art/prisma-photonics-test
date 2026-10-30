import type { Database } from '@job-queue/kernel';
import { describe, expect, it } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';

import { DatabaseShutdown } from './database-shutdown.js';

describe('DatabaseShutdown', () => {
  it('closes the database once when its module is destroyed', async () => {
    const database = mockDeep<Database>();
    database.close.mockResolvedValueOnce({});

    await new DatabaseShutdown(database).onModuleDestroy();

    expect(database.close).toHaveBeenCalledOnce();
    expect(database.ping).not.toHaveBeenCalled();
  });

  it('lets a failing close reach the shutdown', async () => {
    const database = mockDeep<Database>();
    const failure = new Error('pool already ended');
    database.close.mockRejectedValueOnce(failure);

    await expect(new DatabaseShutdown(database).onModuleDestroy()).rejects.toBe(failure);
  });
});
