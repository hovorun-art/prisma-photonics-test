import { createContext } from 'react';

import type { JobsApi } from './jobs-api';

/** The `JobsApi` the job pages use; `main.tsx` provides the real one, tests one pointed at MSW. */
export const JobsApiContext = createContext<JobsApi | null>(null);
