import { Plus } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';

import { Button } from '@/components/ui/button';
import { API_BASE_PATH } from '@/config';
import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import { ComingSoon } from './coming-soon';
import { PageErrorBoundary } from './page-error-boundary';

const NAV_LINK =
  'rounded-md px-3 py-2 font-medium text-muted-foreground no-underline hover:text-foreground';

/** The frame of every page (design "Main"): header with mark, navigation and "New job", then the page. */
export function AppFrame() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-10 max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-2.5">
          <Link
            to="/jobs"
            className="flex items-center gap-2.5 text-[15px] font-semibold text-foreground no-underline"
          >
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <rect x="1" y="1" width="20" height="20" rx="5" fill="#17171A" />
              <path
                d="M6 8h10M6 11h7M6 14h4"
                stroke="#FFFFFF"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            {en.frame.productName}
          </Link>
          <nav aria-label={en.frame.navLabel} className="flex gap-1">
            <NavLink
              to="/jobs"
              className={({ isActive }) => cn(NAV_LINK, isActive && 'bg-secondary text-foreground')}
            >
              {en.frame.jobs}
            </NavLink>
            <a
              href={`${API_BASE_PATH}/docs`}
              target="_blank"
              rel="noopener noreferrer"
              className={NAV_LINK}
            >
              {en.frame.apiDocs}
            </a>
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <ComingSoon className="rounded-full">
              <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[13px] text-subtle-foreground">
                <span className="size-2 rounded-full bg-disabled-foreground" aria-hidden="true" />
                {en.frame.apiStatus}
              </span>
            </ComingSoon>
            <Button asChild size="lg" className="h-10 px-4 text-primary-foreground no-underline">
              <Link to="/jobs/new">
                <Plus aria-hidden="true" />
                {en.frame.newJob}
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 pt-8 pb-14">
        <PageErrorBoundary>
          <Outlet />
        </PageErrorBoundary>
      </main>
    </div>
  );
}
