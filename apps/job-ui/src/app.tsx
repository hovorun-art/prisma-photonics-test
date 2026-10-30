import { Navigate, Route, Routes } from 'react-router';

import {
  AppFrame,
  GroupPage,
  GroupsListPage,
  JobPage,
  JobsListPage,
  NewGroupPage,
  SubmitJobPage,
} from '@/features';

/** The pages and their URLs; `/` and unknown paths go to the jobs list. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppFrame />}>
        <Route path="/jobs" element={<JobsListPage />} />
        <Route path="/jobs/new" element={<SubmitJobPage />} />
        <Route path="/jobs/:id" element={<JobPage />} />
        <Route path="/groups" element={<GroupsListPage />} />
        <Route path="/groups/new" element={<NewGroupPage />} />
        <Route path="/groups/:id" element={<GroupPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/jobs" replace />} />
    </Routes>
  );
}
