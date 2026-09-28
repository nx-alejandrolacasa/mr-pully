// Runtime state. storage.session holds everything that can be rebuilt after a
// restart; storage.local holds what must survive it (dismissals, viewer).

import type { Dismissals } from "./dismissals.ts";
import type { Inbox } from "./inbox.ts";
import type { GroupStatus, Managed, StoredGroup } from "./sync.ts";

export interface SessionState {
  inbox: Inbox;
  managed: Managed;
  group?: StoredGroup;
  groupStatus: GroupStatus;
  closingByUs: number[];
  pendingRemoval: Record<string, number>;
  retryAfter?: number;
  syncNotBefore?: number;
}

export interface LocalState {
  dismissed: Dismissals;
  viewer?: string;
}

const SESSION_DEFAULTS: SessionState = {
  inbox: { items: [], truncated: [] },
  managed: {},
  groupStatus: { kind: "empty" },
  closingByUs: [],
  pendingRemoval: {},
};

const SESSION_KEYS = [
  "inbox",
  "managed",
  "group",
  "groupStatus",
  "closingByUs",
  "pendingRemoval",
  "retryAfter",
  "syncNotBefore",
] as const satisfies readonly (keyof SessionState)[];

export async function readSession(): Promise<SessionState> {
  const data = await chrome.storage.session.get([...SESSION_KEYS]);
  return { ...SESSION_DEFAULTS, ...(data as Partial<SessionState>) };
}

export async function writeSession(patch: Partial<SessionState>): Promise<void> {
  const removed = SESSION_KEYS.filter((key) => key in patch && patch[key] === undefined);
  const kept = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  await Promise.all([
    chrome.storage.session.set(kept),
    removed.length > 0 ? chrome.storage.session.remove([...removed]) : undefined,
  ]);
}

export async function readLocal(): Promise<LocalState> {
  const data = await chrome.storage.local.get(["dismissed", "viewer"]);
  const dismissed = typeof data.dismissed === "object" && data.dismissed !== null ? (data.dismissed as Dismissals) : {};
  return { dismissed, ...(typeof data.viewer === "string" ? { viewer: data.viewer } : {}) };
}

export async function writeLocal(patch: Partial<LocalState>): Promise<void> {
  await chrome.storage.local.set(patch);
}
