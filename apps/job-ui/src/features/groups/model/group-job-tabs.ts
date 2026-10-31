import type { JobType } from '@job-queue/contracts';

/** What a tab's form starts with: a type, and the form values of a duplicated job, if any. */
export interface GroupJobSeed {
  readonly type: JobType;
  /** The form values to start with; left out means the type's initial values. */
  readonly values?: Readonly<Record<string, unknown>>;
}

/** One job of the group being built, as a tab. */
export interface GroupJobTab {
  /** Stable while the tab exists, so its form survives tabs being added or removed before it. */
  readonly key: number;
  readonly seed: GroupJobSeed;
}

export interface DuplicateGroupJobTabsRequest {
  /** The tab to copy; the copy goes right after it. */
  readonly index: number;
  /** The tab's current type and values, which the copy starts with. */
  readonly seed: GroupJobSeed;
}
export interface RemoveGroupJobTabsRequest {
  readonly index: number;
}
export interface OpenGroupJobTabsRequest {
  readonly index: number;
}
export interface ChangeGroupJobTabsResponse {
  /** The tabs after the change; the same tabs when the change is not allowed. */
  readonly next: GroupJobTabs;
}

/**
 * The jobs of the new group page as tabs, in order, with the open one. Immutable: every change
 * returns the next tabs. At least one tab, and at most the configured maximum.
 */
export interface GroupJobTabs {
  readonly tabs: readonly GroupJobTab[];
  readonly openIndex: number;
  /** False at the maximum: "+" and Duplicate are disabled. */
  readonly canAdd: boolean;
  /** False while only one tab is left: no ×. */
  readonly canRemove: boolean;
  /** Adds an Email job with initial values at the end and opens it. */
  add(): ChangeGroupJobTabsResponse;
  /** Inserts a copy right after a tab and opens the copy. */
  duplicate(req: DuplicateGroupJobTabsRequest): ChangeGroupJobTabsResponse;
  /** Removes a tab; when it was open, the tab before it (or the new first) opens. */
  remove(req: RemoveGroupJobTabsRequest): ChangeGroupJobTabsResponse;
  open(req: OpenGroupJobTabsRequest): ChangeGroupJobTabsResponse;
}
