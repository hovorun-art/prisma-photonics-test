import { useCallback, useEffect, useRef, useState } from 'react';

import { useUiConfig } from './use-ui-config';

export interface UseCopy {
  /** True for the configured time after a copy, so the button can read "Copied". */
  readonly copied: boolean;
  readonly copy: (text: string) => Promise<void>;
}

/** Copies text to the clipboard and remembers it briefly for the button's feedback. */
export function useCopy(): UseCopy {
  const { copiedFeedbackMs } = useUiConfig();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string) => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
      }, copiedFeedbackMs);
    },
    [copiedFeedbackMs],
  );

  return { copied, copy };
}
