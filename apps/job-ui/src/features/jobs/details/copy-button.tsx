import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { en } from '@/locales';

import { useCopy } from '../hooks/use-copy';

/** A button that copies `text` and reads "Copied" for a moment. */
export function CopyButton({
  text,
  label,
  ...props
}: { text: string; label: string } & Omit<ComponentProps<typeof Button>, 'onClick'>) {
  const { copied, copy } = useCopy();
  return (
    <Button
      variant="outline"
      {...props}
      onClick={() => {
        void copy(text);
      }}
    >
      {copied ? en.copy.copied : label}
    </Button>
  );
}
