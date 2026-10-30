import { act, renderHook } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UI_CONFIG, UiConfigContext } from '@/config';

import { useCopy } from './use-copy';

afterEach(() => {
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    UiConfigContext,
    { value: { ...UI_CONFIG, copiedFeedbackMs: 1000 } },
    children,
  );
}

describe('useCopy', () => {
  it('writes the text to the clipboard and reads "copied" for the configured time', async () => {
    userEvent.setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { result } = renderHook(() => useCopy(), { wrapper });

    await act(() => result.current.copy('{"to":"ops@acme.test"}'));

    expect(await navigator.clipboard.readText()).toBe('{"to":"ops@acme.test"}');
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copied).toBe(false);
  });
});
