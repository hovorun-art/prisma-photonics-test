import './index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { AppRoutes } from '@/app';
import { API_BASE_PATH, UI_CONFIG, UiConfigContext } from '@/config';
import { FetchGroupsApi, FetchJobsApi, GroupsApiContext, JobsApiContext } from '@/features';
import { en } from '@/locales';

// Polling already asks again at the configured interval, so a failed query is not retried.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const apiParams = {
  baseUrl: `${window.location.origin}${API_BASE_PATH}`,
  networkErrorMessage: en.errors.network,
};
const jobsApi = new FetchJobsApi(apiParams);
// Group calls go under the same prefix; nginx and the dev proxy send them to job-group-service.
const groupsApi = new FetchGroupsApi(apiParams);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <JobsApiContext value={jobsApi}>
          <GroupsApiContext value={groupsApi}>
            <UiConfigContext value={UI_CONFIG}>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </UiConfigContext>
          </GroupsApiContext>
        </JobsApiContext>
      </QueryClientProvider>
    </StrictMode>,
  );
}
