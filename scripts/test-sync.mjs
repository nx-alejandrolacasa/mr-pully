// Live tab group reconciliation and group-removal classification.
// Run via:  npm test
import assert from "node:assert";
import { classifyRemovals, nextRemovalAt, planSync } from "../packages/shared/src/sync.ts";

const NOW = 1_000_000;
const GRACE = 30_000;
const url = (n) => `https://github.com/acme/api/pull/${n}`;
const pr = (n, extra = {}) => ({
  id: `PR_${n}`,
  key: `acme/api#${n}`,
  url: url(n),
  number: n,
  headRefOid: "head",
  section: "review",
  ...extra,
});
const tab = (id, tabUrl, { groupId = -1, windowId = 1, index = id, active = false } = {}) => ({
  id,
  url: tabUrl,
  groupId,
  windowId,
  index,
  active,
});
const ourGroup = { id: 7, title: "Pull requests", windowId: 1 };
const managedTab = (n) => ({ prId: `PR_${n}`, key: `acme/api#${n}` });
const plan = (overrides) =>
  planSync({
    items: [],
    groupSections: new Set(["review", "team"]),
    tabs: [],
    groups: [],
    managed: {},
    group: undefined,
    groupStatus: { kind: "empty" },
    pendingRemoval: {},
    dismissed: {},
    groupName: "Pull requests",
    graceMs: GRACE,
    lastFocusedWindowId: 1,
    now: NOW,
    ...overrides,
  });
const opened = (result) => result.open.map((item) => item.id);

// The group is created lazily, only when there is a PR to open.
{
  const empty = plan({});
  assert.equal(empty.createGroup, false);
  assert.deepEqual(empty.open, []);
  assert.deepEqual(empty.groupStatus, { kind: "empty" });

  const result = plan({ items: [pr(1), pr(2, { section: "team" }), pr(3, { section: "drafts" })] });
  assert.equal(result.createGroup, true);
  assert.deepEqual(opened(result), ["PR_1", "PR_2"]);
  assert.equal(result.openInWindowId, 1);
}

// No window to open in → nothing happens.
assert.deepEqual(plan({ items: [pr(1)], lastFocusedWindowId: undefined }).open, []);

// After a restart the group is found by title and its PR tabs are adopted,
// including sub-pages; only the first tab of a PR is adopted.
{
  const result = plan({
    items: [pr(1), pr(2)],
    groups: [{ id: 70, title: "Pull requests", windowId: 2 }],
    tabs: [
      tab(10, `${url(1)}/files`, { groupId: 70, windowId: 2, index: 0 }),
      tab(11, url(1), { groupId: 70, windowId: 2, index: 1 }),
      tab(12, "https://example.com/", { groupId: 70, windowId: 2, index: 2 }),
    ],
    lastFocusedWindowId: 1,
  });
  assert.deepEqual(result.managed, { 10: managedTab(1) });
  assert.deepEqual(result.group, { groupId: 70, windowId: 2 });
  assert.deepEqual(result.groupStatus, { kind: "ok" });
  assert.deepEqual(opened(result), ["PR_2"]);
  assert.equal(result.openInWindowId, 2);
  assert.equal(result.createGroup, false);
  assert.deepEqual(result.close, []);
}

// A PR already open outside the group isn't duplicated.
assert.deepEqual(plan({ items: [pr(1)], tabs: [tab(20, `${url(1)}/commits`, { windowId: 3 })] }).open, []);

// Grace period: scheduled, cancelled, executed.
{
  const base = { groups: [ourGroup], group: { groupId: 7, windowId: 1 }, managed: { 10: managedTab(1) } };
  const tabs = [tab(10, url(1), { groupId: 7 })];

  const scheduled = plan({ ...base, tabs, items: [] });
  assert.deepEqual(scheduled.pendingRemoval, { PR_1: NOW + GRACE });
  assert.deepEqual(scheduled.close, []);
  assert.deepEqual(scheduled.managed, { 10: managedTab(1) });
  assert.equal(nextRemovalAt(scheduled.pendingRemoval), NOW + GRACE);

  const cancelled = plan({ ...base, tabs, items: [pr(1)], pendingRemoval: { PR_1: NOW + 5 } });
  assert.deepEqual(cancelled.pendingRemoval, {});
  assert.equal(nextRemovalAt(cancelled.pendingRemoval), undefined);

  const due = plan({ ...base, tabs, items: [], pendingRemoval: { PR_1: NOW } });
  assert.deepEqual(due.close, [10]);
  assert.deepEqual(due.managed, {});
  assert.deepEqual(due.pendingRemoval, {});

  const immediate = plan({ ...base, tabs, items: [], graceMs: 0 });
  assert.deepEqual(immediate.close, [10]);

  // Still being read: the active tab of the last focused window waits.
  const reading = plan({ ...base, tabs: [tab(10, url(1), { groupId: 7, active: true })], pendingRemoval: { PR_1: NOW } });
  assert.deepEqual(reading.close, []);
  assert.deepEqual(reading.pendingRemoval, { PR_1: NOW + GRACE });

  const activeElsewhere = plan({
    ...base,
    tabs: [tab(10, url(1), { groupId: 7, active: true })],
    pendingRemoval: { PR_1: NOW },
    lastFocusedWindowId: 2,
  });
  assert.deepEqual(activeElsewhere.close, [10]);

  // Navigated to another PR: no longer managed, never closed.
  const navigated = plan({ ...base, tabs: [tab(10, url(9), { groupId: 7 })], pendingRemoval: { PR_1: NOW } });
  assert.deepEqual(navigated.managed, {});
  assert.deepEqual(navigated.close, []);

  // Navigating within the same PR keeps it managed.
  const subPage = plan({ ...base, tabs: [tab(10, `${url(1)}/files`, { groupId: 7 })], items: [pr(1)] });
  assert.deepEqual(subPage.managed, { 10: managedTab(1) });
}

// Foreign tabs in the group are never adopted or closed.
{
  const result = plan({
    groups: [ourGroup],
    tabs: [tab(30, url(99), { groupId: 7 }), tab(31, "https://example.com/", { groupId: 7 })],
    items: [],
  });
  assert.deepEqual(result.managed, {});
  assert.deepEqual(result.close, []);
}

// Two groups with the configured title → duplicate, no tab actions.
{
  const result = plan({
    items: [pr(1)],
    groups: [ourGroup, { id: 8, title: "Pull requests", windowId: 2 }],
    tabs: [tab(10, url(2), { groupId: 7 })],
    managed: { 10: managedTab(2) },
    pendingRemoval: { PR_2: NOW },
  });
  assert.deepEqual(result.groupStatus, { kind: "duplicate", count: 2 });
  assert.deepEqual(result.open, []);
  assert.deepEqual(result.close, []);
  assert.equal(result.createGroup, false);
}

// The stored group wins over another group with the same title.
{
  const result = plan({
    groups: [{ id: 8, title: "Pull requests", windowId: 2 }, ourGroup],
    group: { groupId: 7, windowId: 1 },
  });
  assert.deepEqual(result.groupStatus, { kind: "ok" });
  assert.deepEqual(result.group, { groupId: 7, windowId: 1 });
}

// Lost: not recreated until the user asks; a restored group is picked up.
{
  const lost = plan({ items: [pr(1)], groupStatus: { kind: "lost" } });
  assert.deepEqual(lost.groupStatus, { kind: "lost" });
  assert.deepEqual(lost.open, []);
  assert.equal(lost.createGroup, false);

  const restored = plan({
    items: [pr(1)],
    groupStatus: { kind: "lost" },
    groups: [ourGroup],
    tabs: [tab(10, url(1), { groupId: 7 })],
  });
  assert.deepEqual(restored.groupStatus, { kind: "ok" });
  assert.deepEqual(restored.managed, { 10: managedTab(1) });
}

// Renamed by the user: reported with the new title, no tab actions; renaming
// it back by hand makes it ours again.
{
  const renamed = plan({
    items: [pr(1), pr(2)],
    groups: [{ ...ourGroup, title: "My PRs" }],
    group: { groupId: 7, windowId: 1 },
    tabs: [tab(10, url(1), { groupId: 7 })],
    managed: { 10: managedTab(1) },
  });
  assert.deepEqual(renamed.groupStatus, { kind: "renamed", groupId: 7, title: "My PRs" });
  assert.deepEqual(renamed.group, { groupId: 7, windowId: 1 });
  assert.deepEqual(renamed.managed, { 10: managedTab(1) });
  assert.deepEqual(renamed.open, []);
  assert.deepEqual(renamed.close, []);

  // A PR that finishes while renamed keeps its tab (and pending removal)
  // until the rename is resolved, then the tab closes as usual.
  const whileRenamed = {
    items: [],
    groups: [{ ...ourGroup, title: "My PRs" }],
    group: { groupId: 7, windowId: 1 },
    groupStatus: { kind: "renamed", groupId: 7, title: "My PRs" },
    tabs: [tab(10, url(1), { groupId: 7 })],
    managed: { 10: managedTab(1) },
    pendingRemoval: { PR_1: NOW },
  };
  const stillRenamed = plan(whileRenamed);
  assert.deepEqual(stillRenamed.close, []);
  assert.deepEqual(stillRenamed.managed, { 10: managedTab(1) });
  assert.deepEqual(stillRenamed.pendingRemoval, { PR_1: NOW });

  const adopted = plan({ ...whileRenamed, groupName: "My PRs" });
  assert.deepEqual(adopted.groupStatus, { kind: "ok" });
  assert.deepEqual(adopted.close, [10]);

  const unnamed = plan({ ...whileRenamed, groups: [{ ...ourGroup, title: "" }] });
  assert.deepEqual(unnamed.groupStatus, { kind: "renamed", groupId: 7, title: "" });

  const back = plan({
    items: [pr(1)],
    groups: [ourGroup],
    group: { groupId: 7, windowId: 1 },
    groupStatus: { kind: "renamed", groupId: 7, title: "My PRs" },
    tabs: [tab(10, url(1), { groupId: 7 })],
  });
  assert.deepEqual(back.groupStatus, { kind: "ok" });
  assert.deepEqual(back.managed, { 10: managedTab(1) });
}

// Titles match exactly.
for (const title of ["Pull requests (3)", "pull requests", "Pull*", "Pull requests "]) {
  const result = plan({ items: [pr(1)], groups: [{ id: 9, title, windowId: 1 }] });
  assert.equal(result.createGroup, true, title);
  assert.equal(result.group, undefined, title);
}

// Dismissed PRs stay closed until they change; dragging one back in undoes it.
{
  const dismissed = { PR_1: { headRefOid: "head", dismissedAt: 1 } };
  assert.deepEqual(plan({ items: [pr(1)], dismissed }).open, []);

  const pushed = plan({ items: [pr(1, { headRefOid: "new" })], dismissed });
  assert.deepEqual(opened(pushed), ["PR_1"]);
  assert.deepEqual(pushed.dismissed, {});

  const reRequested = plan({ items: [pr(1, { lastReviewRequestAt: "2026-09-28T00:00:00Z" })], dismissed });
  assert.deepEqual(opened(reRequested), ["PR_1"]);

  const gone = plan({ items: [], dismissed });
  assert.deepEqual(gone.dismissed, {});

  const draggedBack = plan({ items: [pr(1)], dismissed, groups: [ourGroup], tabs: [tab(10, url(1), { groupId: 7 })] });
  assert.deepEqual(draggedBack.managed, { 10: managedTab(1) });
  assert.deepEqual(draggedBack.dismissed, {});
}

// A managed tab with no URL yet is still loading: kept, and its PR not reopened.
{
  const loading = plan({ items: [pr(1)], groups: [ourGroup], managed: { 10: managedTab(1) }, tabs: [tab(10, "", { groupId: 7 })] });
  assert.deepEqual(loading.managed, { 10: managedTab(1) });
  assert.deepEqual(opened(loading), []);
}

// A PR tab redirected to login (signed out) is still that PR's tab: kept, not reopened.
{
  const login = `https://github.com/login?return_to=${encodeURIComponent("/acme/api/pull/1")}`;
  const signedOut = plan({ items: [pr(1)], groups: [ourGroup], managed: { 10: managedTab(1) }, tabs: [tab(10, login, { groupId: 7 })] });
  assert.deepEqual(signedOut.managed, { 10: managedTab(1) });
  assert.deepEqual(opened(signedOut), []);
}

// Group removal: window closed, whole group closed, or its last tab closed.
{
  const removed = (n, isWindowClosing = false) => ({ kind: "removed", entry: managedTab(n), isWindowClosing });
  const groupRemoved = (windowClosing = false) => ({ kind: "groupRemoved", windowClosing });

  assert.deepEqual(classifyRemovals([removed(1)]), { dismiss: [managedTab(1)] });
  assert.deepEqual(classifyRemovals([removed(1), removed(2)]), { dismiss: [managedTab(1), managedTab(2)] });
  assert.deepEqual(classifyRemovals([removed(1, true)]), { dismiss: [] });

  assert.deepEqual(classifyRemovals([removed(1, true), removed(2, true), groupRemoved()]), { dismiss: [], groupStatus: "empty" });
  assert.deepEqual(classifyRemovals([removed(1), groupRemoved(true)]), { dismiss: [], groupStatus: "empty" });

  assert.deepEqual(classifyRemovals([removed(1), removed(2), groupRemoved()]), { dismiss: [], groupStatus: "lost" });
  assert.deepEqual(classifyRemovals([groupRemoved(), removed(1), removed(2)]), { dismiss: [], groupStatus: "lost" });
  assert.deepEqual(
    classifyRemovals([{ kind: "ungrouped", entry: managedTab(1) }, removed(2), groupRemoved()]),
    { dismiss: [], groupStatus: "lost" }
  );

  assert.deepEqual(classifyRemovals([removed(1), groupRemoved()]), { dismiss: [managedTab(1)], groupStatus: "empty" });
  assert.deepEqual(classifyRemovals([groupRemoved()]), { dismiss: [], groupStatus: "empty" });
}

console.log("sync: ok");
