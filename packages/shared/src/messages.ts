// Popup → background requests. The background owns the inbox and the tab
// group, so the popup never changes them directly.

import type { Inbox, PrItem } from "./inbox.ts";
import type { GroupStatus } from "./sync.ts";

export type Request =
  | { type: "get-inbox" }
  | { type: "refresh" }
  | { type: "open-pr"; url: string }
  | { type: "reopen-pr"; prId: string }
  | { type: "recreate-group" }
  | { type: "adopt-renamed-group" }
  | { type: "rename-group-back" }
  | { type: "use-group"; windowId: number };

export interface InboxView {
  inbox: Inbox;
  groupStatus: GroupStatus;
  dismissed: PrItem[];
  retryAfter?: number;
}

export function isRequest(value: unknown): value is Request {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case "get-inbox":
    case "refresh":
    case "recreate-group":
    case "adopt-renamed-group":
    case "rename-group-back":
      return true;
    case "open-pr":
      return typeof v.url === "string";
    case "reopen-pr":
      return typeof v.prId === "string";
    case "use-group":
      return typeof v.windowId === "number";
    default:
      return false;
  }
}

export function sendRequest<T>(request: Request): Promise<T> {
  return chrome.runtime.sendMessage(request) as Promise<T>;
}
