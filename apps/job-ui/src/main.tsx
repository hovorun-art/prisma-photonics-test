import './index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { AppRoutes } from '@/app';
import { API_BASE_PATH, UI_CONFIG, UiConfigContext } from '@/config';
import { FetchJobsApi, JobsApiContext } from '@/features';
import { en } from '@/locales';

// Polling already asks again at the configured interval, so a failed query is not retried.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const jobsApi = new FetchJobsApi({
  baseUrl: `${window.location.origin}${API_BASE_PATH}`,
  networkErrorMessage: en.errors.network,
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <JobsApiContext value={jobsApi}>
          <UiConfigContext value={UI_CONFIG}>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </UiConfigContext>
        </JobsApiContext>
      </QueryClientProvider>
    </StrictMode>,
  );
}
