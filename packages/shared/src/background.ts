// Background: refreshes the inbox from GitHub, keeps the badge current,
// wires tab and group events to the pure logic in sync.ts and executes the
// plans it returns. Every state change runs through `serialized()`.

import { updateBadge } from "./badge.ts";
import { dismissalOf } from "./dismissals.ts";
import { fetchInbox, type FetchResult, type Source } from "./github.ts";
import { buildInbox, SECTION_SOURCE, truncatedSources, type Inbox, type PrItem } from "./inbox.ts";
import { isRequest, type InboxView, type Request } from "./messages.ts";
import { prKey } from "./prs.ts";
import {
  loadSettings,
  loadToken,
  saveSettings,
  SECTION_IDS,
  sectionsWith,
  SETTINGS_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
  normalizeSettings,
  type Settings,
} from "./settings.ts";
import { readLocal, readSession, writeLocal, writeSession } from "./state.ts";
import {
  classifyRemovals,
  nextRemovalAt,
  planSync,
  type BufferedEvent,
  type GroupInfo,
  type ManagedTab,
  type StoredGroup,
  type SyncPlan,
  type TabInfo,
} from "./sync.ts";

export interface Platform {
  minAlarmMs: number;
  createsDiscardedTabs: boolean;
}

const REFRESH_ALARM = "refresh";
const REMOVAL_ALARM = "remove";
const STARTUP_SYNC_DELAY_MS = 5000;
const EVENT_BUFFER_MS = 500;
const POPUP_STALE_MS = 30_000;
const NO_GROUP = -1;

let platform: Platform;

export function runBackground(target: Platform): void {
  platform = target;

  chrome.runtime.onInstalled.addListener(() => {
    void ensureRefreshAlarm();
    void refresh();
  });

  chrome.runtime.onStartup.addListener(() => void startup());

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) void refresh();
    if (alarm.name === REMOVAL_ALARM) void serialized(sync);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const settingsChange = changes[SETTINGS_STORAGE_KEY];
    if (settingsChange) {
      void serialized(() => settingsChanged(normalizeSettings(settingsChange.oldValue))).then(() =>
        refresh({ restart: true })
      );
    } else if (TOKEN_STORAGE_KEY in changes) {
      void serialized(() => writeSession({ retryAfter: undefined })).then(() => refresh({ restart: true }));
    }
  });

  chrome.tabs.onRemoved.addListener((tabId, { isWindowClosing }) => {
    void serialized(() => tabRemoved(tabId, isWindowClosing));
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url === undefined && changeInfo.groupId === undefined) return;
    void serialized(() => tabUpdated(tabId, changeInfo));
  });

  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    void serialized(() => tabReplaced(addedTabId, removedTabId));
  });

  const onGroupRemoved = (group: chrome.tabGroups.TabGroup, removeInfo?: { isWindowClosing?: boolean }) => {
    void serialized(() => groupRemoved(group, removeInfo?.isWindowClosing === true));
  };
  chrome.tabGroups.onRemoved.addListener(onGroupRemoved);
  chrome.tabGroups.onUpdated.addListener(() => void serialized(sync));

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isRequest(message)) return;
    handle(message).then(sendResponse, (error: unknown) => {
      console.error("[mr-pully]", error);
      sendResponse(undefined);
    });
    return true;
  });

  void ensureRefreshAlarm();
}

// --- Refresh ---

let requestSeq = 0;
let inflight: Promise<void> | undefined;

// Refresh triggers share the request in flight, except settings changes: a
// response fetched with the old token or sources must never be applied.
function refresh({ restart = false } = {}): Promise<void> {
  if (inflight && !restart) return inflight;
  const seq = ++requestSeq;
  const run = (async () => {
    const [settings, token, session] = await Promise.all([loadSettings(), loadToken(), readSession()]);
    if (session.retryAfter !== undefined && session.retryAfter > Date.now()) return;
    const result = await fetchInbox(token, sourcesFor(settings));
    await serialized(() => (seq === requestSeq ? applyFetch(result) : Promise.resolve()));
  })()
    .catch((error: unknown) => console.error("[mr-pully] refresh failed", error))
    .finally(() => {
      if (inflight === run) inflight = undefined;
    });
  inflight = run;
  return run;
}

function sourcesFor(settings: Settings): Source[] {
  const used = SECTION_IDS.filter((id) => Object.values(settings.sections[id]).some(Boolean));
  return [...new Set(used.map((id) => SECTION_SOURCE[id]))];
}

async function applyFetch(result: FetchResult): Promise<void> {
  const now = Date.now();
  const [settings, session, local] = await Promise.all([loadSettings(), readSession(), readLocal()]);
  let inbox: Inbox;
  let retryAfter: number | undefined;

  if (!result.ok) {
    const { error } = result;
    inbox =
      error.kind === "no-token"
        ? { items: [], truncated: [], error, attemptedAt: now }
        : { ...session.inbox, error, attemptedAt: now };
    retryAfter = error.kind === "rate-limited" ? error.until : undefined;
  } else {
    const viewer = result.data.viewer.login;
    const accountChanged = local.viewer !== undefined && local.viewer !== viewer;
    if (local.viewer !== viewer) await writeLocal({ viewer, ...(accountChanged ? { dismissed: {} } : {}) });
    const previous = accountChanged ? undefined : session.inbox;
    inbox = {
      items: buildInbox(result.data, { ...(previous ? { previous } : {}), staleDays: settings.staleDays, now }),
      truncated: truncatedSources(result.data),
      viewer,
      fetchedAt: now,
      attemptedAt: now,
      ssoRequired: result.ssoRequired,
    };
    retryAfter = result.retryAfter;
  }

  await writeSession({ inbox, retryAfter });
  await updateBadge(inbox, session.groupStatus, settings);
  await sync();
}

// --- Tab group sync ---

async function sync(): Promise<void> {
  const [settings, session, local] = await Promise.all([loadSettings(), readSession(), readLocal()]);
  if (!settings.liveGroup || session.inbox.fetchedAt === undefined) return;
  if (session.syncNotBefore !== undefined && Date.now() < session.syncNotBefore) return;

  const { tabs, groups, lastFocusedWindowId } = await readBrowser();
  const plan = planSync({
    items: session.inbox.items,
    groupSections: sectionsWith(settings, "group"),
    tabs,
    groups,
    managed: session.managed,
    group: session.group,
    groupStatus: session.groupStatus,
    pendingRemoval: session.pendingRemoval,
    dismissed: local.dismissed,
    groupName: settings.groupName,
    graceMs: settings.graceSeconds * 1000,
    lastFocusedWindowId,
    now: Date.now(),
  });

  if (plan.close.length > 0) {
    await writeSession({ closingByUs: [...session.closingByUs, ...plan.close] });
    await chrome.tabs.remove(plan.close).catch(() => {});
  }
  const { managed, group } = await openTabs(plan, settings);
  const groupStatus = group && plan.groupStatus.kind === "empty" ? { kind: "ok" as const } : plan.groupStatus;

  await writeSession({ managed, group, groupStatus, pendingRemoval: plan.pendingRemoval });
  if (JSON.stringify(plan.dismissed) !== JSON.stringify(local.dismissed)) await writeLocal({ dismissed: plan.dismissed });
  await scheduleRemoval(groupStatus.kind === "ok" ? plan.pendingRemoval : {});
  await updateBadge(session.inbox, groupStatus, settings);
}

async function readBrowser(): Promise<{ tabs: TabInfo[]; groups: GroupInfo[]; lastFocusedWindowId?: number }> {
  const windows = (await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] })).filter((w) => !w.incognito);
  const windowIds = new Set(windows.map((w) => w.id));
  const tabs = windows.flatMap((w) => w.tabs ?? []).flatMap((tab): TabInfo[] =>
    tab.id === undefined
      ? []
      : [
          {
            id: tab.id,
            url: tab.url || tab.pendingUrl || "",
            windowId: tab.windowId,
            groupId: tab.groupId ?? NO_GROUP,
            index: tab.index,
            active: tab.active,
          },
        ]
  );
  const groups = (await chrome.tabGroups.query({}))
    .filter((g) => windowIds.has(g.windowId))
    .map((g) => ({ id: g.id, title: g.title ?? "", windowId: g.windowId }));
  const lastFocused = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => undefined);
  const lastFocusedWindowId = lastFocused && !lastFocused.incognito ? lastFocused.id : windows[0]?.id;
  return { tabs, groups, ...(lastFocusedWindowId !== undefined ? { lastFocusedWindowId } : {}) };
}

async function openTabs(plan: SyncPlan, settings: Settings): Promise<{ managed: SyncPlan["managed"]; group?: StoredGroup }> {
  const managed = { ...plan.managed };
  let group = plan.group;
  const windowId = plan.openInWindowId;
  if (plan.open.length === 0 || windowId === undefined) return { managed, ...(group ? { group } : {}) };

  const created: number[] = [];
  for (const item of plan.open) {
    const tab = await createTab(item, windowId, settings.openDiscarded).catch(() => undefined);
    if (tab?.id === undefined) continue;
    created.push(tab.id);
    managed[tab.id] = { prId: item.id, key: item.key };
  }
  const [first, ...rest] = created;
  if (first === undefined) return { managed, ...(group ? { group } : {}) };
  const tabIds: [number, ...number[]] = [first, ...rest];

  if (group) {
    await chrome.tabs.group({ groupId: group.groupId, tabIds });
  } else {
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    group = { groupId, windowId };
    await chrome.tabGroups.update(groupId, { title: settings.groupName, color: settings.groupColor });
  }
  return { managed, group };
}

// Firefox can create a tab unloaded, with a title; Chrome can only discard
// it afterwards, and the discarded tab may come back with a new id.
async function createTab(item: PrItem, windowId: number, discarded: boolean): Promise<chrome.tabs.Tab | undefined> {
  const { url } = item;
  if (discarded && platform.createsDiscardedTabs) {
    const properties = { url, windowId, active: false, discarded: true, title: githubPageTitle(item) };
    return chrome.tabs.create(properties as chrome.tabs.CreateProperties);
  }
  const tab = await chrome.tabs.create({ url, windowId, active: false });
  if (!discarded || tab.id === undefined) return tab;
  return (await chrome.tabs.discard(tab.id).catch(() => undefined)) ?? tab;
}

function githubPageTitle({ title, author, number, repo }: PrItem): string {
  return `${title} by ${author} · Pull Request #${number} · ${repo}`;
}

async function scheduleRemoval(pendingRemoval: Record<string, number>): Promise<void> {
  const at = nextRemovalAt(pendingRemoval);
  if (at === undefined) await chrome.alarms.clear(REMOVAL_ALARM);
  else await chrome.alarms.create(REMOVAL_ALARM, { when: Math.max(at, Date.now() + platform.minAlarmMs) });
}

// --- Tab and group events ---

let buffer: BufferedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function bufferEvent(event: BufferedEvent): void {
  buffer.push(event);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void serialized(flushEvents), EVENT_BUFFER_MS);
}

async function flushEvents(): Promise<void> {
  const events = buffer;
  buffer = [];
  const outcome = classifyRemovals(events);
  const [session, local] = await Promise.all([readSession(), readLocal()]);
  if (outcome.dismiss.length > 0) {
    const byId = new Map(session.inbox.items.map((item) => [item.id, item]));
    const dismissed = { ...local.dismissed };
    for (const { prId } of outcome.dismiss) {
      const item = byId.get(prId);
      if (item) dismissed[prId] = dismissalOf(item, Date.now());
    }
    await writeLocal({ dismissed });
  }
  if (outcome.groupStatus) await writeSession({ groupStatus: { kind: outcome.groupStatus } });
  await sync();
}

async function tabRemoved(tabId: number, isWindowClosing: boolean): Promise<void> {
  const session = await readSession();
  if (session.closingByUs.includes(tabId)) {
    await writeSession({ closingByUs: session.closingByUs.filter((id) => id !== tabId) });
    return;
  }
  const entry = await forgetManaged(tabId, session.managed);
  if (entry) bufferEvent({ kind: "removed", entry, isWindowClosing });
}

async function tabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo): Promise<void> {
  const session = await readSession();
  const entry = session.managed[tabId];
  const ourGroupId = session.group?.groupId;

  if (changeInfo.groupId !== undefined) {
    if (entry && changeInfo.groupId !== ourGroupId) {
      await forgetManaged(tabId, session.managed);
      bufferEvent({ kind: "ungrouped", entry });
    } else if (!entry && changeInfo.groupId === ourGroupId) {
      await sync();
    }
    return;
  }
  if (entry && prKey(changeInfo.url) !== entry.key) await forgetManaged(tabId, session.managed);
}

async function tabReplaced(addedTabId: number, removedTabId: number): Promise<void> {
  const { managed } = await readSession();
  const entry = managed[removedTabId];
  if (!entry) return;
  const { [removedTabId]: _, ...rest } = managed;
  await writeSession({ managed: { ...rest, [addedTabId]: entry } });
}

async function forgetManaged(tabId: number, managed: Record<string, ManagedTab>): Promise<ManagedTab | undefined> {
  const entry = managed[tabId];
  if (!entry) return undefined;
  const { [tabId]: _, ...rest } = managed;
  await writeSession({ managed: rest });
  return entry;
}

async function groupRemoved(group: chrome.tabGroups.TabGroup, isWindowClosing: boolean): Promise<void> {
  const session = await readSession();
  if (session.group?.groupId !== group.id) return;
  await writeSession({ group: undefined });
  const windowGone = await chrome.windows.get(group.windowId).then(
    () => false,
    () => true
  );
  bufferEvent({ kind: "groupRemoved", windowClosing: isWindowClosing || windowGone });
}

// --- Settings and startup ---

async function settingsChanged(previous: Settings): Promise<void> {
  const [settings, session] = await Promise.all([loadSettings(), readSession()]);
  if (previous.liveGroup && !settings.liveGroup) {
    await writeSession({ managed: {}, pendingRemoval: {} });
    await chrome.alarms.clear(REMOVAL_ALARM);
  }
  const groupChanged = previous.groupName !== settings.groupName || previous.groupColor !== settings.groupColor;
  const current = session.group && (await chrome.tabGroups.get(session.group.groupId).catch(() => undefined));
  if (groupChanged && current?.title === previous.groupName) {
    await chrome.tabGroups.update(current.id, { title: settings.groupName, color: settings.groupColor }).catch(() => {});
  }
  await ensureRefreshAlarm(settings);
  await updateBadge(session.inbox, session.groupStatus, settings);
}

async function ensureRefreshAlarm(settings?: Settings): Promise<void> {
  const { refreshMinutes } = settings ?? (await loadSettings());
  const existing = await chrome.alarms.get(REFRESH_ALARM);
  if (existing?.periodInMinutes === refreshMinutes) return;
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: refreshMinutes, delayInMinutes: refreshMinutes });
}

// Session restore brings the old group back a few seconds after startup;
// syncing earlier would create a second group next to it.
async function startup(): Promise<void> {
  await serialized(() => writeSession({ syncNotBefore: Date.now() + STARTUP_SYNC_DELAY_MS }));
  setTimeout(() => void serialized(sync), STARTUP_SYNC_DELAY_MS + 100);
  await ensureRefreshAlarm();
  await refresh();
}

// --- Popup requests ---

async function handle(request: Request): Promise<InboxView | undefined> {
  switch (request.type) {
    case "get-inbox": {
      const view = await serialized(readView);
      const attemptedAt = view.inbox.attemptedAt ?? 0;
      if (Date.now() - attemptedAt > POPUP_STALE_MS) void refresh();
      return view;
    }
    case "refresh":
      await refresh();
      return serialized(readView);
    case "open-pr":
      await serialized(() => openPr(request.url));
      return undefined;
    case "reopen-pr":
      return serialized(async () => {
        const { dismissed } = await readLocal();
        const { [request.prId]: _, ...rest } = dismissed;
        await writeLocal({ dismissed: rest });
        await sync();
        return readView();
      });
    case "recreate-group":
      return serialized(async () => {
        await writeSession({ groupStatus: { kind: "empty" } });
        await sync();
        return readView();
      });
    case "adopt-renamed-group":
      return serialized(async () => {
        const [settings, { groupStatus }] = await Promise.all([loadSettings(), readSession()]);
        if (groupStatus.kind === "renamed" && groupStatus.title) {
          await saveSettings({ ...settings, groupName: groupStatus.title });
        }
        return readView();
      });
    case "rename-group-back":
      return serialized(async () => {
        const [settings, { groupStatus }] = await Promise.all([loadSettings(), readSession()]);
        if (groupStatus.kind === "renamed") {
          await chrome.tabGroups.update(groupStatus.groupId, { title: settings.groupName }).catch(() => {});
          await sync();
        }
        return readView();
      });
    case "use-group":
      return serialized(async () => {
        const settings = await loadSettings();
        const groups = await chrome.tabGroups.query({ windowId: request.windowId });
        const chosen = groups.find((g) => g.title === settings.groupName);
        if (chosen) {
          await writeSession({ group: { groupId: chosen.id, windowId: chosen.windowId } });
          await sync();
        }
        return readView();
      });
  }
}

async function readView(): Promise<InboxView> {
  const [session, local] = await Promise.all([readSession(), readLocal()]);
  return {
    inbox: session.inbox,
    groupStatus: session.groupStatus,
    dismissed: session.inbox.items.filter((item) => item.id in local.dismissed),
    ...(session.retryAfter !== undefined ? { retryAfter: session.retryAfter } : {}),
  };
}

async function openPr(url: string): Promise<void> {
  const key = prKey(url);
  if (!key) return;
  const { managed } = await readSession();
  const { tabs, lastFocusedWindowId } = await readBrowser();
  const matching = tabs.filter((tab) => prKey(tab.url) === key);
  const existing = matching.find((tab) => managed[tab.id]) ?? matching[0];
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url, ...(lastFocusedWindowId !== undefined ? { windowId: lastFocusedWindowId } : {}) });
}

// Storage reads and writes from concurrent events would otherwise race.
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}
