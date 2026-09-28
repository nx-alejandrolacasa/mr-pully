// Popup: the inbox grouped by section like GitHub's, plus banners for errors
// and tab group problems. Everything GitHub sends is rendered as text.

import type { InboxError } from "./github.ts";
import { SECTION_SOURCE, type PrItem } from "./inbox.ts";
import { sendRequest, type InboxView, type Request } from "./messages.ts";
import { prKey } from "./prs.ts";
import { loadSettings, SECTION_IDS, type Settings } from "./settings.ts";
import { byId, el, localize, msg, relativeTime } from "./ui.ts";

const TOKEN_SETTINGS_URL = "https://github.com/settings/tokens";
const CHECK_ICONS = { success: "✓", failure: "✗", pending: "●" } as const;

export async function runPopup(): Promise<void> {
  localize();
  byId<HTMLButtonElement>("refresh").addEventListener("click", () => void refresh());
  byId<HTMLButtonElement>("options").addEventListener("click", () => void openOptions());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && ("inbox" in changes || "groupStatus" in changes)) void load();
    if (area === "local" && ("settings" in changes || "dismissed" in changes)) void load();
  });
  await load();
}

async function load(): Promise<void> {
  const [view, settings] = await Promise.all([sendRequest<InboxView | undefined>({ type: "get-inbox" }), loadSettings()]);
  if (view) render(view, settings);
}

async function refresh(): Promise<void> {
  const button = byId<HTMLButtonElement>("refresh");
  button.disabled = true;
  try {
    const [view, settings] = await Promise.all([sendRequest<InboxView | undefined>({ type: "refresh" }), loadSettings()]);
    if (view) render(view, settings);
  } finally {
    button.disabled = false;
  }
}

async function openOptions(): Promise<void> {
  await chrome.runtime.openOptionsPage();
  window.close();
}

async function act(request: Request): Promise<void> {
  const view = await sendRequest<InboxView | undefined>(request);
  if (view) render(view, await loadSettings());
}

function render(view: InboxView, settings: Settings): void {
  const { inbox } = view;
  byId("updated").textContent = inbox.fetchedAt ? msg("updatedAgo", relativeTime(inbox.fetchedAt)) : "";
  renderBanners(view, settings);

  const sections = byId("sections");
  sections.replaceChildren();
  const truncated = new Set(inbox.truncated);
  for (const id of SECTION_IDS) {
    if (!settings.sections[id].popup) continue;
    const items = inbox.items.filter((item) => item.section === id);
    if (items.length === 0) continue;
    const count = `${items.length}${truncated.has(SECTION_SOURCE[id]) ? "+" : ""}`;
    sections.append(renderSection(msg(`section_${id}`), count, items.map(renderItem)));
  }

  const nothingShown = sections.childElementCount === 0;
  byId("empty-state").hidden = !nothingShown || inbox.fetchedAt === undefined;
  renderDismissed(view.dismissed, settings);
}

function renderSection(title: string, count: string, rows: HTMLElement[], open = true): HTMLDetailsElement {
  const details = el("details", "section");
  details.open = open;
  const summary = el("summary");
  summary.append(el("span", "section-title", title), el("span", "count", count));
  const list = el("ul", "items");
  list.append(...rows);
  details.append(summary, list);
  return details;
}

function renderItem(item: PrItem): HTMLLIElement {
  const row = el("li");
  const button = el("button", "pr");
  button.type = "button";
  button.title = item.url;
  button.addEventListener("click", () => void openPr(item.url));

  const main = el("span", "pr-main");
  main.append(
    el("span", "pr-title", item.title),
    el("span", "pr-meta", `${item.repo}#${item.number} · ${item.author} · ${msg("updatedAgo", relativeTime(Date.parse(item.updatedAt)))}`)
  );

  const side = el("span", "pr-side");
  if (item.label) side.append(el("span", `label label-${item.label}`, msg(`label_${item.label}`)));
  if (item.checks) {
    const { passed, total, state } = item.checks;
    const checks = el("span", `checks checks-${state}`, `${CHECK_ICONS[state]} ${passed}/${total}`);
    checks.title = msg("checksTitle");
    side.append(checks);
  }
  if (item.comments > 0) {
    const comments = el("span", "comments", `💬 ${item.comments}`);
    comments.title = msg("commentsTitle");
    side.append(comments);
  }

  button.append(main, side);
  row.append(button);
  return row;
}

function renderDismissed(dismissed: PrItem[], settings: Settings): void {
  const container = byId("dismissed");
  container.replaceChildren();
  if (!settings.liveGroup || dismissed.length === 0) return;
  const rows = dismissed.map((item) => {
    const row = el("li", "dismissed-row");
    const title = el("span", "pr-title", item.title);
    title.title = `${item.repo}#${item.number}`;
    const reopen = el("button", "secondary", msg("reopen"));
    reopen.type = "button";
    reopen.addEventListener("click", () => void act({ type: "reopen-pr", prId: item.id }));
    row.append(title, reopen);
    return row;
  });
  container.append(renderSection(msg("hiddenFromGroup"), String(dismissed.length), rows, false));
}

function renderBanners(view: InboxView, settings: Settings): void {
  const banners = byId("banners");
  banners.replaceChildren();
  const { inbox, groupStatus } = view;

  if (inbox.error) banners.append(errorBanner(inbox.error));
  if (inbox.ssoRequired) banners.append(banner("warning", msg("ssoRequired"), link(msg("authorize"), TOKEN_SETTINGS_URL)));

  if (!settings.liveGroup) return;
  const name = settings.groupName;
  switch (groupStatus.kind) {
    case "lost":
      banners.append(banner("warning", msg("groupLost", name), button(msg("recreateGroup"), { type: "recreate-group" })));
      break;
    case "renamed": {
      const renameBack = button(msg("renameBack"), { type: "rename-group-back" });
      banners.append(
        groupStatus.title
          ? banner(
              "warning",
              msg("groupRenamed", groupStatus.title),
              button(msg("useTitle", groupStatus.title), { type: "adopt-renamed-group" }),
              renameBack
            )
          : banner("warning", msg("groupUnnamed", name), renameBack)
      );
      break;
    }
    case "duplicate": {
      const use = el("button", "secondary", msg("useThisOne"));
      use.type = "button";
      use.addEventListener("click", () => {
        void chrome.windows.getCurrent().then((w) => (w.id === undefined ? undefined : act({ type: "use-group", windowId: w.id })));
      });
      banners.append(banner("warning", msg("groupDuplicate", String(groupStatus.count), name), use));
      break;
    }
  }
}

function errorBanner(error: InboxError): HTMLElement {
  const settingsButton = el("button", "secondary", msg("openSettings"));
  settingsButton.type = "button";
  settingsButton.addEventListener("click", () => void openOptions());
  switch (error.kind) {
    case "no-token":
      return banner("error", msg("errorNoToken"), settingsButton);
    case "unauthorized":
      return banner("error", msg("errorUnauthorized"), settingsButton);
    case "rate-limited":
      return banner("note", msg("errorRateLimited", relativeTime(error.until)));
    case "network":
      return banner("note", `${msg("errorNetwork")} ${msg("showingLastResults")}`);
    case "github":
      return banner("note", msg("errorGithub", error.message));
  }
}

function banner(kind: "error" | "warning" | "note", text: string, ...actions: HTMLElement[]): HTMLElement {
  const box = el("div", `banner banner-${kind}`);
  box.setAttribute("role", kind === "note" ? "status" : "alert");
  box.append(el("p", undefined, text));
  if (actions.length > 0) {
    const row = el("div", "banner-actions");
    row.append(...actions);
    box.append(row);
  }
  return box;
}

function button(text: string, request: Request): HTMLButtonElement {
  const node = el("button", "secondary", text);
  node.type = "button";
  node.addEventListener("click", () => void act(request));
  return node;
}

function link(text: string, href: string): HTMLAnchorElement {
  const node = el("a", "secondary-link", text);
  node.href = href;
  node.target = "_blank";
  node.rel = "noreferrer";
  return node;
}

async function openPr(url: string): Promise<void> {
  if (!prKey(url)) return;
  await sendRequest({ type: "open-pr", url });
  window.close();
}
