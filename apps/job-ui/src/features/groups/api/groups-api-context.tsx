import { createContext } from 'react';

import type { GroupsApi } from './groups-api';

/** The `GroupsApi` the group pages use; `main.tsx` provides the real one, tests one pointed at MSW. */
export const GroupsApiContext = createContext<GroupsApi | null>(null);
