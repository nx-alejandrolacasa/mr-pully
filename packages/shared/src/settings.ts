// Settings (storage.local, never sync). The token is stored under its own key
// so pages that only need settings, like the popup, never load it.

export type SectionId = "review" | "team" | "drafts" | "waiting" | "action" | "ready";
export const SECTION_IDS: readonly SectionId[] = ["review", "team", "drafts", "waiting", "action", "ready"];

export const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export interface SectionSettings {
  popup: boolean;
  badge: boolean;
  group: boolean;
}

export interface Settings {
  refreshMinutes: number;
  groupName: string;
  groupColor: GroupColor;
  liveGroup: boolean;
  openDiscarded: boolean;
  graceSeconds: number;
  staleDays: number;
  badgeColor: string;
  sections: Record<SectionId, SectionSettings>;
}

export const LIMITS = {
  refreshMinutes: [1, 60],
  graceSeconds: [0, 600],
  staleDays: [0, 365],
} as const;

export const DEFAULT_SETTINGS: Settings = {
  refreshMinutes: 2,
  groupName: "Pull requests",
  groupColor: "grey",
  liveGroup: true,
  openDiscarded: true,
  graceSeconds: 30,
  staleDays: 30,
  badgeColor: "#0969da",
  sections: {
    review: { popup: true, badge: true, group: true },
    team: { popup: true, badge: true, group: true },
    drafts: { popup: true, badge: false, group: false },
    waiting: { popup: true, badge: false, group: false },
    action: { popup: true, badge: true, group: false },
    ready: { popup: true, badge: true, group: false },
  },
};

export const SETTINGS_STORAGE_KEY = "settings";
export const TOKEN_STORAGE_KEY = "token";

export function clampNumber(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (value === "" || value === null || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function normalizeSettings(value: unknown): Settings {
  const v = record(value);
  const d = DEFAULT_SETTINGS;
  const groupName = typeof v.groupName === "string" ? v.groupName.trim() : "";
  const sections = record(v.sections);
  return {
    refreshMinutes: clampNumber(v.refreshMinutes, LIMITS.refreshMinutes, d.refreshMinutes),
    groupName: groupName || d.groupName,
    groupColor: GROUP_COLORS.find((c) => c === v.groupColor) ?? d.groupColor,
    liveGroup: bool(v.liveGroup, d.liveGroup),
    openDiscarded: bool(v.openDiscarded, d.openDiscarded),
    graceSeconds: clampNumber(v.graceSeconds, LIMITS.graceSeconds, d.graceSeconds),
    staleDays: clampNumber(v.staleDays, LIMITS.staleDays, d.staleDays),
    badgeColor: typeof v.badgeColor === "string" && HEX_COLOR.test(v.badgeColor) ? v.badgeColor : d.badgeColor,
    sections: Object.fromEntries(
      SECTION_IDS.map((id) => {
        const s = record(sections[id]);
        const fallback = d.sections[id];
        return [
          id,
          {
            popup: bool(s.popup, fallback.popup),
            badge: bool(s.badge, fallback.badge),
            group: bool(s.group, fallback.group),
          },
        ];
      })
    ) as Record<SectionId, SectionSettings>,
  };
}

export function sectionsWith(settings: Settings, flag: keyof SectionSettings): Set<SectionId> {
  return new Set(SECTION_IDS.filter((id) => settings.sections[id][flag]));
}

export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  return normalizeSettings(data[SETTINGS_STORAGE_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: normalizeSettings(settings) });
}

export async function loadToken(): Promise<string> {
  const data = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
  const token = data[TOKEN_STORAGE_KEY];
  return typeof token === "string" ? token : "";
}

export async function saveToken(token: string): Promise<void> {
  if (token) await chrome.storage.local.set({ [TOKEN_STORAGE_KEY]: token });
  else await chrome.storage.local.remove(TOKEN_STORAGE_KEY);
}
