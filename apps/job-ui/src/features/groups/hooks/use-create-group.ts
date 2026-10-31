import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useJobsApi } from '../../jobs/api/use-jobs-api';
import { useGroupsApi } from '../api/use-groups-api';
import type { CreateGroupCreationRequest } from '../model/group-creation';
import { GroupCreationImpl } from '../model/group-creation.impl';

/** Creates a group with its jobs; on success the groups and jobs lists are refreshed. */
export function useCreateGroup() {
  const groups = useGroupsApi();
  const jobs = useJobsApi();
  const queryClient = useQueryClient();
  const creation = useMemo(() => new GroupCreationImpl({ groups, jobs }), [groups, jobs]);
  return useMutation({
    mutationFn: (request: CreateGroupCreationRequest) => creation.create(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
