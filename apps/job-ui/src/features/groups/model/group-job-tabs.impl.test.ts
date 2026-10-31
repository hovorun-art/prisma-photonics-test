import { describe, expect, it } from 'vitest';

import type { GroupJobTabs } from './group-job-tabs';
import { GroupJobTabsImpl } from './group-job-tabs.impl';

const MAX_JOBS = 4;

describe('GroupJobTabsImpl', () => {
  /** Tabs with `count` Email jobs at initial values, the first one open. */
  const tabsOf = (count: number, maxJobs = MAX_JOBS): GroupJobTabs => {
    let tabs: GroupJobTabs = new GroupJobTabsImpl({ maxJobs });
    for (let i = 1; i < count; i++) tabs = tabs.add().next;
    return tabs.open({ index: 0 }).next;
  };

  it('New group page at first: one Email job at initial values, open', () => {
    const tabs = new GroupJobTabsImpl({ maxJobs: MAX_JOBS });

    expect(tabs.tabs).toHaveLength(1);
    expect(tabs.tabs[0]?.seed).toEqual({ type: 'email' });
    expect(tabs.openIndex).toBe(0);
  });

  it('Add a job: an Email job at initial values is added at the end and opened', () => {
    const tabs = tabsOf(1).add().next;

    expect(tabs.tabs.map((tab) => tab.seed)).toEqual([{ type: 'email' }, { type: 'email' }]);
    expect(tabs.openIndex).toBe(1);
  });

  it('each tab gets its own key, kept while other tabs change', () => {
    const three = tabsOf(3);
    const [first, , third] = three.tabs;

    const after = three.remove({ index: 1 }).next;

    expect(new Set(three.tabs.map((tab) => tab.key)).size).toBe(3);
    expect(after.tabs.map((tab) => tab.key)).toEqual([first?.key, third?.key]);
  });

  it('Duplicate a job: the copy goes right after it with the given values, later jobs shift', () => {
    const seed = { type: 'webhook' as const, values: { url: 'https://example.com/hook' } };
    const two = tabsOf(2);
    const [first, second] = two.tabs;

    const tabs = two.duplicate({ index: 0, seed }).next;

    expect(tabs.tabs).toHaveLength(3);
    expect(tabs.tabs[0]?.key).toBe(first?.key);
    expect(tabs.tabs[1]?.seed).toEqual(seed);
    expect(tabs.tabs[2]?.key).toBe(second?.key);
  });

  it('a duplicate gets a key of its own', () => {
    const tabs = tabsOf(1).duplicate({ index: 0, seed: { type: 'email' } }).next;

    expect(tabs.tabs[0]?.key).not.toBe(tabs.tabs[1]?.key);
  });

  it('Duplicate a job: the copy is opened', () => {
    const tabs = tabsOf(2)
      .open({ index: 1 })
      .next.duplicate({ index: 1, seed: { type: 'email' } }).next;

    expect(tabs.openIndex).toBe(2);
  });

  it('duplicating a job other than the open one opens the copy', () => {
    const three = tabsOf(3).open({ index: 2 }).next;

    const tabs = three.duplicate({ index: 0, seed: { type: 'email' } }).next;

    expect(tabs.openIndex).toBe(1);
    expect(three.tabs.map((tab) => tab.key)).not.toContain(tabs.tabs[1]?.key);
  });

  it('Remove a job: removing the open middle job opens the job before it', () => {
    const three = tabsOf(3).open({ index: 1 }).next;
    const [first, , third] = three.tabs;

    const tabs = three.remove({ index: 1 }).next;

    expect(tabs.tabs.map((tab) => tab.key)).toEqual([first?.key, third?.key]);
    expect(tabs.openIndex).toBe(0);
  });

  it('Remove the first job: the former second job is first and open', () => {
    const two = tabsOf(2);
    const second = two.tabs[1];

    const tabs = two.remove({ index: 0 }).next;

    expect(tabs.tabs).toEqual([second]);
    expect(tabs.openIndex).toBe(0);
  });

  it('removing a job before the open one keeps the same job open', () => {
    const three = tabsOf(3).open({ index: 2 }).next;
    const openKey = three.tabs[2]?.key;

    const tabs = three.remove({ index: 0 }).next;

    expect(tabs.tabs[tabs.openIndex]?.key).toBe(openKey);
  });

  it('removing a job after the open one keeps the open job', () => {
    const three = tabsOf(3).open({ index: 1 }).next;
    const openKey = three.tabs[1]?.key;

    const tabs = three.remove({ index: 2 }).next;

    expect(tabs.openIndex).toBe(1);
    expect(tabs.tabs[1]?.key).toBe(openKey);
  });

  it('removing the open last job opens the job before it', () => {
    const three = tabsOf(3).open({ index: 2 }).next;
    const secondKey = three.tabs[1]?.key;

    const tabs = three.remove({ index: 2 }).next;

    expect(tabs.tabs).toHaveLength(2);
    expect(tabs.openIndex).toBe(1);
    expect(tabs.tabs[1]?.key).toBe(secondKey);
  });

  it('Last job cannot be removed', () => {
    const one = tabsOf(1);

    expect(one.canRemove).toBe(false);
    expect(one.remove({ index: 0 }).next.tabs).toEqual(one.tabs);
    expect(tabsOf(2).canRemove).toBe(true);
  });

  it('At the maximum: add and duplicate change nothing', () => {
    const full = tabsOf(MAX_JOBS);

    expect(full.canAdd).toBe(false);
    expect(full.add().next.tabs).toEqual(full.tabs);
    expect(full.duplicate({ index: 0, seed: { type: 'email' } }).next.tabs).toEqual(full.tabs);
    expect(tabsOf(MAX_JOBS - 1).canAdd).toBe(true);
  });

  it('Below the maximum again: removing a job at the maximum allows adding', () => {
    const tabs = tabsOf(MAX_JOBS).remove({ index: 0 }).next;

    expect(tabs.canAdd).toBe(true);
    expect(tabs.add().next.tabs).toHaveLength(MAX_JOBS);
    expect(tabs.duplicate({ index: 0, seed: { type: 'email' } }).next.tabs).toHaveLength(MAX_JOBS);
  });

  it('a maximum of one job allows no add', () => {
    expect(tabsOf(1, 1).canAdd).toBe(false);
  });

  it('opens the chosen tab', () => {
    expect(tabsOf(3).open({ index: 2 }).next.openIndex).toBe(2);
  });

  it('opening an index without a tab changes nothing', () => {
    const tabs = tabsOf(2);

    expect(tabs.open({ index: 5 }).next.openIndex).toBe(0);
    expect(tabs.open({ index: -1 }).next.openIndex).toBe(0);
  });

  it('removing or duplicating an index without a tab changes nothing', () => {
    const tabs = tabsOf(2);

    expect(tabs.remove({ index: 5 }).next.tabs).toEqual(tabs.tabs);
    expect(tabs.duplicate({ index: 5, seed: { type: 'email' } }).next.tabs).toEqual(tabs.tabs);
  });
});
