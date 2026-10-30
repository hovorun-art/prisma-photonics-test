import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { useLocation } from 'react-router';

import { Button } from '@/components/ui/button';
import { en } from '@/locales';

/**
 * Contains an error to the page it happened on: the page shows "Something went wrong" with Reload,
 * while the frame around it keeps working. Reload also resets the failed queries, so they load
 * again; moving to another page clears the error.
 */
export function PageErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary onReset={reset} resetKeys={[pathname]} FallbackComponent={PageError}>
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

function PageError({ resetErrorBoundary }: FallbackProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-5 py-14 text-center"
    >
      <div className="font-medium">{en.pageError.title}</div>
      <Button variant="outline" onClick={resetErrorBoundary}>
        <RotateCw aria-hidden="true" />
        {en.pageError.reload}
      </Button>
    </div>
  );
}
