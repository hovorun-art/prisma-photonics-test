import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router';

import { UI_CONFIG, type UiConfig, UiConfigContext } from '@/config';

import { FetchGroupsApi } from '../../groups/api/fetch-groups-api';
import { GroupsApiContext } from '../../groups/api/groups-api-context';
import { FetchJobsApi } from '../api/fetch-jobs-api';
import { JobsApiContext } from '../api/jobs-api-context';

/** Where MSW answers in tests; jsdom's own origin, so relative links and the cURL base agree. */
export const TEST_API_BASE = `${window.location.origin}/api`;

/** Test-only: the providers `main.tsx` sets up, with a MemoryRouter and an API pointed at MSW. */
export function TestProviders({
  children,
  path = '/',
  config = {},
}: {
  children: ReactNode;
  path?: string;
  config?: Partial<UiConfig>;
}) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [api] = useState(
    () => new FetchJobsApi({ baseUrl: TEST_API_BASE, networkErrorMessage: 'API unreachable' }),
  );
  const [groupsApi] = useState(
    () => new FetchGroupsApi({ baseUrl: TEST_API_BASE, networkErrorMessage: 'API unreachable' }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <JobsApiContext value={api}>
        <GroupsApiContext value={groupsApi}>
          <UiConfigContext value={{ ...UI_CONFIG, pollIntervalMs: 60_000, ...config }}>
            <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
          </UiConfigContext>
        </GroupsApiContext>
      </JobsApiContext>
    </QueryClientProvider>
  );
}

/** Test-only: shows the current path, so a test can see where a click navigated to. */
export function CurrentPath() {
  return <output aria-label="current path">{useLocation().pathname}</output>;
}
