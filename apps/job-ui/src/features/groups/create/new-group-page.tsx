import type { CreateJobRequest, JobType } from '@job-queue/contracts';
import { Plus, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/class-names';
import { en } from '@/locales';

import { ApiError } from '../../jobs/api/api-error';
import { ApiRejectionAlert } from '../../jobs/model/api-rejection-alert';
import { useUiConfig } from '../../jobs/hooks/use-ui-config';
import { useCreateGroup } from '../hooks/use-create-group';
import { BulkIssueSplitter } from '../model/bulk-issue-splitter';
import type { GroupJobSeed, GroupJobTabs } from '../model/group-job-tabs';
import { GroupJobTabsImpl } from '../model/group-job-tabs.impl';
import { GroupJobTab, type GroupJobTabHandle } from './group-job-tab';

/**
 * Create a group with its jobs, one tab per job (layout of the submit page, no request preview).
 * On "Create group" every tab is checked, then the group is created and its jobs submitted;
 * after success the new group's page opens.
 */
export function NewGroupPage() {
  const config = useUiConfig();
  const navigate = useNavigate();
  const create = useCreateGroup();
  const [splitter] = useState(() => new BulkIssueSplitter());
  const [rejection] = useState(() => new ApiRejectionAlert());
  const [tabs, setTabs] = useState<GroupJobTabs>(
    () => new GroupJobTabsImpl({ maxJobs: config.maxGroupJobs }),
  );
  /** The current type of each tab, by tab key, once it differs from the tab's seed. */
  const [types, setTypes] = useState<Readonly<Record<number, JobType>>>({});
  /** The keys of the tabs whose form shows an error. */
  const [invalid, setInvalid] = useState<ReadonlySet<number>>(new Set());
  const [alert, setAlert] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const handles = useRef(new Map<number, GroupJobTabHandle>());
  const busy = checking || create.isPending;

  const onHandle = useCallback((key: number, handle: GroupJobTabHandle | null) => {
    if (handle) handles.current.set(key, handle);
    else handles.current.delete(key);
  }, []);
  const onErrorsChange = useCallback((key: number, hasErrors: boolean) => {
    setInvalid((current) => {
      if (current.has(key) === hasErrors) return current;
      const next = new Set(current);
      if (hasErrors) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const onTypeChange = useCallback((key: number, type: JobType) => {
    setTypes((current) => ({ ...current, [key]: type }));
  }, []);
  const onDuplicate = useCallback((key: number, seed: GroupJobSeed) => {
    setTabs((current) => {
      const index = current.tabs.findIndex((tab) => tab.key === key);
      return current.duplicate({ index, seed }).next;
    });
  }, []);

  /** Shows a rejected submit: API issues on their jobs' fields, everything else in the alert. */
  const showError = (error: Error, keys: readonly number[]) => {
    const unmatched: string[] = [];
    let fieldCount = 0;
    if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
      const split = splitter.split({ details: error.details, jobCount: keys.length });
      unmatched.push(...split.unmatched);
      let firstShown = -1;
      keys.forEach((key, index) => {
        const details = split.jobs[index];
        const handle = handles.current.get(key);
        if (!details || details.issues.length === 0 || !handle) return;
        const shown = handle.showApiIssues({ details });
        unmatched.push(...shown.unmatched);
        fieldCount += shown.fieldCount;
        if (shown.fieldCount > 0 && firstShown < 0) firstShown = index;
      });
      if (firstShown >= 0) setTabs((current) => current.open({ index: firstShown }).next);
    }
    setAlert(rejection.message({ error, fieldCount, unmatched }).message);
  };

  const onCreate = async () => {
    if (busy) return;
    setChecking(true);
    const keys = tabs.tabs.map((tab) => tab.key);
    const checked = await Promise.all(
      keys.map((key) => handles.current.get(key)?.validate() ?? Promise.resolve({ request: null })),
    );
    setChecking(false);
    const jobs = checked.flatMap(({ request }): CreateJobRequest[] => (request ? [request] : []));
    if (jobs.length < keys.length) {
      const firstInvalid = checked.findIndex(({ request }) => request === null);
      setTabs((current) => current.open({ index: firstInvalid }).next);
      return;
    }
    setAlert(null);
    create.mutate(
      { jobs },
      {
        onSuccess: ({ group }) => {
          void navigate(`/groups/${group.id}`);
        },
        onError: (error) => {
          showError(error, keys);
        },
      },
    );
  };

  return (
    <>
      <nav aria-label={en.job.breadcrumb} className="flex gap-2 text-[13px] text-muted-foreground">
        <Link to="/groups" className="text-muted-foreground">
          {en.group.groups}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">{en.newGroup.breadcrumbNew}</span>
      </nav>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">{en.newGroup.title}</h1>
        <p className="m-0 text-muted-foreground">{en.newGroup.subtitle}</p>
      </div>
      <div className="flex flex-col gap-2">
        <div
          role="tablist"
          aria-label={en.newGroup.tabsLabel}
          className="flex flex-wrap items-center gap-1.5"
        >
          {tabs.tabs.map((tab, index) => {
            const open = index === tabs.openIndex;
            const red = invalid.has(tab.key);
            return (
              <div
                key={tab.key}
                className={cn(
                  'flex items-center rounded-md border text-[13px] font-medium',
                  open ? 'border-primary bg-card shadow-xs' : 'border-border bg-secondary',
                  red && 'border-destructive bg-destructive-muted text-destructive',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  id={`group-job-tab-${String(tab.key)}`}
                  aria-controls={`group-job-panel-${String(tab.key)}`}
                  aria-selected={open}
                  aria-invalid={red ? true : undefined}
                  className="h-8 px-3"
                  onClick={() => {
                    setTabs((current) => current.open({ index }).next);
                  }}
                >
                  {en.newGroup.tabLabel(
                    index + 1,
                    en.list.typeFilters[types[tab.key] ?? tab.seed.type],
                  )}
                </button>
                {tabs.canRemove && (
                  <button
                    type="button"
                    aria-label={en.newGroup.removeJob(index + 1)}
                    className="flex h-8 items-center pr-2 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setTabs((current) => current.remove({ index }).next);
                    }}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            aria-label={en.newGroup.addJob}
            disabled={!tabs.canAdd}
            className="flex size-8 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={() => {
              setTabs((current) => current.add().next);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>
        {!tabs.canAdd && (
          <p className="m-0 text-[13px] text-muted-foreground">
            {en.newGroup.maxJobs(config.maxGroupJobs)}
          </p>
        )}
      </div>
      <div className="flex flex-col rounded-xl border border-border bg-card">
        {tabs.tabs.map((tab, index) => (
          <div
            key={tab.key}
            role="tabpanel"
            id={`group-job-panel-${String(tab.key)}`}
            aria-labelledby={`group-job-tab-${String(tab.key)}`}
            hidden={index !== tabs.openIndex}
          >
            <GroupJobTab
              tabKey={tab.key}
              seed={tab.seed}
              canDuplicate={tabs.canAdd}
              onDuplicate={onDuplicate}
              onTypeChange={onTypeChange}
              onErrorsChange={onErrorsChange}
              onHandle={onHandle}
            />
          </div>
        ))}
        <div className="flex flex-col gap-3 rounded-b-xl border-t border-border bg-surface-muted px-6 py-4">
          {alert && (
            <Alert variant="destructive" className="border-destructive-border bg-destructive-muted">
              <AlertDescription>{alert}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button asChild variant="outline" className="h-10 no-underline">
              <Link to="/groups">{en.newGroup.cancel}</Link>
            </Button>
            <Button
              type="button"
              className="h-10 px-[18px]"
              disabled={busy}
              onClick={() => void onCreate()}
            >
              {busy ? en.newGroup.creating : en.newGroup.create(tabs.tabs.length)}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
