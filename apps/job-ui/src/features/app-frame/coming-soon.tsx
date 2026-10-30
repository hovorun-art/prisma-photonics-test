import type { ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/class-names';
import { en } from '@/locales';

/**
 * A control whose API is not built yet: disabled, muted, and a "Coming soon" tooltip on hover and
 * keyboard focus. The wrapper takes the focus, since disabled controls cannot.
 */
export function ComingSoon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-disabled="true"
            className={cn(
              'inline-flex cursor-not-allowed rounded-md opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              className,
            )}
          >
            <fieldset disabled className="contents [&_*]:pointer-events-none">
              {children}
            </fieldset>
          </span>
        </TooltipTrigger>
        <TooltipContent>{en.comingSoon}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
