// Live tab group reconciliation, pure: tracked PRs + current tabs and groups
// + stored state → the next state and the tabs to open or close. The
// background only gathers the inputs and executes the result.

import { activeDismissals, type Dismissals } from "./dismissals.ts";
import { itemsIn, type PrItem } from "./inbox.ts";
import { prKey } from "./prs.ts";
import type { SectionId } from "./settings.ts";

export interface ManagedTab {
  prId: string;
  key: string;
}

export type Managed = Record<string, ManagedTab>;

export interface StoredGroup {
  groupId: number;
  windowId: number;
}

export type GroupStatus =
  | { kind: "ok" }
  | { kind: "empty" }
  | { kind: "lost" }
  | { kind: "renamed"; groupId: number; title: string }
  | { kind: "duplicate"; count: number };

export interface TabInfo {
  id: number;
  url: string;
  windowId: number;
  groupId: number;
  index: number;
  active: boolean;
}

export interface GroupInfo {
  id: number;
  title: string;
  windowId: number;
}

export interface SyncInput {
  items: readonly PrItem[];
  groupSections: ReadonlySet<SectionId>;
  tabs: readonly TabInfo[];
  groups: readonly GroupInfo[];
  managed: Managed;
  group: StoredGroup | undefined;
  groupStatus: GroupStatus;
  pendingRemoval: Record<string, number>;
  dismissed: Dismissals;
  groupName: string;
  graceMs: number;
  lastFocusedWindowId: number | undefined;
  now: number;
}

export interface SyncPlan {
  managed: Managed;
  group: StoredGroup | undefined;
  groupStatus: GroupStatus;
  pendingRemoval: Record<string, number>;
  dismissed: Dismissals;
  open: PrItem[];
  openInWindowId: number | undefined;
  createGroup: boolean;
  close: number[];
}

const BLOCKING_STATUSES = new Set<GroupStatus["kind"]>(["lost", "renamed", "duplicate"]);

export type GroupLookup =
  | { kind: "found"; group: GroupInfo }
  | { kind: "renamed"; group: GroupInfo }
  | { kind: "duplicate"; count: number }
  | { kind: "none" };

// The stored group is matched by id, so a rename is noticed; any other group
// only counts when its title is exactly the configured name.
export function findOurGroup(
  groups: readonly GroupInfo[],
  stored: StoredGroup | undefined,
  groupName: string
): GroupLookup {
  const storedGroup = stored && groups.find((g) => g.id === stored.groupId);
  if (storedGroup) return { kind: storedGroup.title === groupName ? "found" : "renamed", group: storedGroup };
  const matches = groups.filter((g) => g.title === groupName);
  if (matches.length > 1) return { kind: "duplicate", count: matches.length };
  return matches[0] ? { kind: "found", group: matches[0] } : { kind: "none" };
}

export function planSync(input: SyncInput): SyncPlan {
  const { now, graceMs } = input;
  const unchanged: SyncPlan = {
    managed: input.managed,
    group: input.group,
    groupStatus: input.groupStatus,
    pendingRemoval: input.pendingRemoval,
    dismissed: input.dismissed,
    open: [],
    openInWindowId: undefined,
    createGroup: false,
    close: [],
  };

  const lookup = findOurGroup(input.groups, input.group, input.groupName);
  if (lookup.kind === "duplicate") {
    return { ...unchanged, group: undefined, groupStatus: { kind: "duplicate", count: lookup.count } };
  }
  // Keeps its tabs and pending removals, so resolving the rename resumes them.
  if (lookup.kind === "renamed") {
    const renamed = lookup.group;
    return {
      ...unchanged,
      managed: managedTabsIn(renamed.id, input.managed, input.tabs),
      group: { groupId: renamed.id, windowId: renamed.windowId },
      groupStatus: { kind: "renamed", groupId: renamed.id, title: renamed.title },
    };
  }
  const our = lookup.kind === "found" ? lookup.group : undefined;
  const group: StoredGroup | undefined = our && { groupId: our.id, windowId: our.windowId };
  const groupStatus: GroupStatus = our
    ? { kind: "ok" }
    : input.groupStatus.kind === "lost"
      ? input.groupStatus
      : { kind: "empty" };

  const tracked = itemsIn(input.items, input.groupSections);
  const trackedByKey = new Map(tracked.map((item) => [item.key, item]));
  const trackedIds = new Set(tracked.map((item) => item.id));
  const tabsById = new Map(input.tabs.map((tab) => [tab.id, tab]));
  const dismissed = activeDismissals(input.dismissed, input.items);

  const managed = our ? managedTabsIn(our.id, input.managed, input.tabs) : {};

  const managedPrIds = () => new Set(Object.values(managed).map((entry) => entry.prId));
  if (our) {
    const groupTabs = input.tabs.filter((tab) => tab.groupId === our.id).sort((a, b) => a.index - b.index);
    const alreadyManaged = managedPrIds();
    for (const tab of groupTabs) {
      if (managed[tab.id]) continue;
      const item = trackedByKey.get(prKey(tab.url) ?? "");
      if (!item || alreadyManaged.has(item.id)) continue;
      managed[tab.id] = { prId: item.id, key: item.key };
      alreadyManaged.add(item.id);
      delete dismissed[item.id];
    }
  }

  const pendingRemoval: Record<string, number> = {};
  const close: number[] = [];
  for (const [tabId, entry] of Object.entries(managed)) {
    if (trackedIds.has(entry.prId)) continue;
    let removeAt = input.pendingRemoval[entry.prId] ?? now + graceMs;
    if (removeAt <= now) {
      const tab = tabsById.get(Number(tabId));
      const beingRead = tab?.active === true && tab.windowId === input.lastFocusedWindowId;
      if (!beingRead) {
        close.push(Number(tabId));
        delete managed[tabId];
        continue;
      }
      removeAt = now + graceMs;
    }
    pendingRemoval[entry.prId] = removeAt;
  }

  const openKeys = new Set(input.tabs.map((tab) => prKey(tab.url)).filter((key) => key !== undefined));
  const stillManaged = managedPrIds();
  let open = tracked.filter((item) => !stillManaged.has(item.id) && !dismissed[item.id] && !openKeys.has(item.key));
  const openInWindowId = our?.windowId ?? input.lastFocusedWindowId;
  const createGroup = !our && open.length > 0;
  if (openInWindowId === undefined || (createGroup && BLOCKING_STATUSES.has(groupStatus.kind))) open = [];

  return {
    managed,
    group,
    groupStatus,
    pendingRemoval,
    dismissed,
    open,
    openInWindowId,
    createGroup: createGroup && open.length > 0,
    close,
  };
}

function managedTabsIn(groupId: number, managed: Managed, tabs: readonly TabInfo[]): Managed {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  return Object.fromEntries(
    Object.entries(managed).filter(([tabId, entry]) => {
      const tab = tabsById.get(Number(tabId));
      return tab !== undefined && tab.groupId === groupId && prKey(tab.url) === entry.key;
    })
  );
}

export function nextRemovalAt(pendingRemoval: Record<string, number>): number | undefined {
  const times = Object.values(pendingRemoval);
  return times.length > 0 ? Math.min(...times) : undefined;
}

// Tab events buffered for a short while, because closing a group, its last
// tab or its window all end in the same `tabGroups.onRemoved`.
export type BufferedEvent =
  | { kind: "removed"; entry: ManagedTab; isWindowClosing: boolean }
  | { kind: "ungrouped"; entry: ManagedTab }
  | { kind: "groupRemoved"; windowClosing: boolean };

export interface RemovalOutcome {
  dismiss: ManagedTab[];
  groupStatus?: "empty" | "lost";
}

export function classifyRemovals(events: readonly BufferedEvent[]): RemovalOutcome {
  const userClosed = events.flatMap((e) => (e.kind === "removed" && !e.isWindowClosing ? [e.entry] : []));
  const groupRemoved = events.find((e) => e.kind === "groupRemoved");
  if (!groupRemoved) return { dismiss: userClosed };

  const windowClosing =
    groupRemoved.windowClosing || events.some((e) => e.kind === "removed" && e.isWindowClosing);
  if (windowClosing) return { dismiss: [], groupStatus: "empty" };

  const leftGroup = events.filter((e) => e.kind === "removed" || e.kind === "ungrouped").length;
  if (leftGroup >= 2) return { dismiss: [], groupStatus: "lost" };
  return { dismiss: userClosed, groupStatus: "empty" };
}
