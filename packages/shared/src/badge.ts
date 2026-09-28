import { isConfigError, itemsIn, type Inbox } from "./inbox.ts";
import { sectionsWith, type Settings } from "./settings.ts";
import type { GroupStatus } from "./sync.ts";

const WARNING_COLOR = "#d1570f";

export function badgeOf(inbox: Inbox, groupStatus: GroupStatus, settings: Settings): { text: string; warning: boolean } {
  const groupBroken = settings.liveGroup && ["lost", "renamed", "duplicate"].includes(groupStatus.kind);
  if (isConfigError(inbox.error) || groupBroken) return { text: "!", warning: true };
  const count = itemsIn(inbox.items, sectionsWith(settings, "badge")).length;
  return { text: count > 0 ? String(count) : "", warning: false };
}

export async function updateBadge(inbox: Inbox, groupStatus: GroupStatus, settings: Settings): Promise<void> {
  const { text, warning } = badgeOf(inbox, groupStatus, settings);
  await Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color: warning ? WARNING_COLOR : settings.badgeColor }),
    chrome.action.setBadgeTextColor?.({ color: "#ffffff" }),
  ]);
}
