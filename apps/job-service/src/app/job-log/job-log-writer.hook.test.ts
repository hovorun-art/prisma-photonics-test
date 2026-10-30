import { describe, expect, it } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';

import type { JobLogStore } from '../../domain/job-log/job-log-store.js';
import type { JobLogStream } from '../../domain/job-log/job-log-stream.js';
import type { JobLogWriter } from '../../domain/job-log/job-log-writer.js';
import { JobLogWriterHook } from './job-log-writer.hook.js';

describe('JobLogWriterHook', () => {
  const build = () => {
    const writer = mockDeep<JobLogWriter>();
    const store = mockDeep<JobLogStore>();
    const stream = mockDeep<JobLogStream>();
    return {
      writer,
      store,
      stream,
      hook: new JobLogWriterHook(writer, store, stream),
    };
  };

  it('starts the writer when the app bootstraps, without waiting for the store', () => {
    const { hook, writer, store, stream } = build();
    writer.start.mockReturnValueOnce({});

    hook.onApplicationBootstrap();

    expect(writer.start).toHaveBeenCalledOnce();
    expect(store.close).not.toHaveBeenCalled();
    expect(stream.close).not.toHaveBeenCalled();
  });

  it('stops the writer, then closes the store and the stream, when the app shuts down', async () => {
    const { hook, writer, store, stream } = build();
    writer.stop.mockResolvedValueOnce({});
    store.close.mockResolvedValueOnce({});
    stream.close.mockResolvedValueOnce({});

    await hook.onApplicationShutdown();

    expect(writer.stop).toHaveBeenCalledOnce();
    expect(store.close).toHaveBeenCalledOnce();
    expect(stream.close).toHaveBeenCalledOnce();
    const stopped = writer.stop.mock.invocationCallOrder[0] ?? Infinity;
    expect(stopped).toBeLessThan(store.close.mock.invocationCallOrder[0] ?? 0);
    expect(stopped).toBeLessThan(stream.close.mock.invocationCallOrder[0] ?? 0);
  });

  it('closes the stream even when the store fails to close', async () => {
    const { hook, writer, store, stream } = build();
    writer.stop.mockResolvedValueOnce({});
    store.close.mockRejectedValueOnce(new Error('close failed'));
    stream.close.mockResolvedValueOnce({});

    await expect(hook.onApplicationShutdown()).rejects.toThrow('close failed');

    expect(stream.close).toHaveBeenCalledOnce();
  });

  it('still closes the store and the stream when the writer fails to stop', async () => {
    const { hook, writer, store, stream } = build();
    writer.stop.mockRejectedValueOnce(new Error('stop failed'));
    store.close.mockResolvedValueOnce({});
    stream.close.mockResolvedValueOnce({});

    await expect(hook.onApplicationShutdown()).rejects.toThrow('stop failed');

    expect(store.close).toHaveBeenCalledOnce();
    expect(stream.close).toHaveBeenCalledOnce();
  });
});
