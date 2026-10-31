import type {
  ChangeGroupJobTabsResponse,
  DuplicateGroupJobTabsRequest,
  GroupJobTab,
  GroupJobTabs,
  OpenGroupJobTabsRequest,
  RemoveGroupJobTabsRequest,
} from './group-job-tabs';

export interface GroupJobTabsImplParams {
  /** The most jobs a group may have (the configured maximum). */
  readonly maxJobs: number;
  /** The tabs to hold; left out means the first state: one Email job at initial values, open. */
  readonly state?: GroupJobTabsState;
}

/** The whole state of the tabs, so a change can build the next instance. */
export interface GroupJobTabsState {
  readonly tabs: readonly GroupJobTab[];
  readonly openIndex: number;
  /** The key the next new tab gets. */
  readonly nextKey: number;
}

/** `GroupJobTabs` as an immutable value; tab keys come from a counter. */
export class GroupJobTabsImpl implements GroupJobTabs {
  private readonly state: GroupJobTabsState;

  constructor(private readonly p: GroupJobTabsImplParams) {
    this.state = p.state ?? {
      tabs: [{ key: 0, seed: { type: 'email' } }],
      openIndex: 0,
      nextKey: 1,
    };
  }

  get tabs(): readonly GroupJobTab[] {
    return this.state.tabs;
  }

  get openIndex(): number {
    return this.state.openIndex;
  }

  get canAdd(): boolean {
    return this.state.tabs.length < this.p.maxJobs;
  }

  get canRemove(): boolean {
    return this.state.tabs.length > 1;
  }

  add(): ChangeGroupJobTabsResponse {
    if (!this.canAdd) return { next: this };
    const { tabs, nextKey } = this.state;
    return this.with({
      tabs: [...tabs, { key: nextKey, seed: { type: 'email' } }],
      openIndex: tabs.length,
      nextKey: nextKey + 1,
    });
  }

  duplicate(req: DuplicateGroupJobTabsRequest): ChangeGroupJobTabsResponse {
    if (!this.canAdd || !this.has(req.index)) return { next: this };
    const { tabs, nextKey } = this.state;
    const copy: GroupJobTab = { key: nextKey, seed: req.seed };
    return this.with({
      tabs: [...tabs.slice(0, req.index + 1), copy, ...tabs.slice(req.index + 1)],
      openIndex: req.index + 1,
      nextKey: nextKey + 1,
    });
  }

  remove(req: RemoveGroupJobTabsRequest): ChangeGroupJobTabsResponse {
    if (!this.canRemove || !this.has(req.index)) return { next: this };
    const { tabs, openIndex, nextKey } = this.state;
    return this.with({
      tabs: tabs.filter((_, index) => index !== req.index),
      // The open tab, or the one before a removed open tab, keeps its place in the shorter list.
      openIndex: openIndex >= req.index ? Math.max(openIndex - 1, 0) : openIndex,
      nextKey,
    });
  }

  open(req: OpenGroupJobTabsRequest): ChangeGroupJobTabsResponse {
    if (!this.has(req.index)) return { next: this };
    return this.with({ ...this.state, openIndex: req.index });
  }

  private has(index: number): boolean {
    return index >= 0 && index < this.state.tabs.length;
  }

  private with(state: GroupJobTabsState): ChangeGroupJobTabsResponse {
    return { next: new GroupJobTabsImpl({ maxJobs: this.p.maxJobs, state }) };
  }
}
