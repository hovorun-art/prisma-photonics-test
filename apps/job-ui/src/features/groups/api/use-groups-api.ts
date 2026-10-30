import { useContext } from 'react';

import { GroupsApiContext } from './groups-api-context';
import type { GroupsApi } from './groups-api';

/** The `GroupsApi` provided by `GroupsApiContext`. */
export function useGroupsApi(): GroupsApi {
  const api = useContext(GroupsApiContext);
  if (!api) throw new TypeError('useGroupsApi needs a GroupsApiContext provider');
  return api;
}
