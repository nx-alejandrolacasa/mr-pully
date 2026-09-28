// Options page. Settings save on every change. The token is write-only: the
// field never shows the stored value, only whether one is saved.

import { checkToken, type TokenCheck } from "./github.ts";
import {
  clampNumber,
  DEFAULT_SETTINGS,
  GROUP_COLORS,
  LIMITS,
  loadSettings,
  loadToken,
  saveSettings,
  saveToken,
  SECTION_IDS,
  type SectionSettings,
  type Settings,
} from "./settings.ts";
import { byId, el, localize, msg, relativeTime } from "./ui.ts";

type NumberSetting = keyof typeof LIMITS;
type BooleanSetting = "liveGroup" | "openDiscarded";

const SECTION_FLAGS: (keyof SectionSettings)[] = ["popup", "badge", "group"];

let settings: Settings;

export async function runOptions(): Promise<void> {
  localize();
  settings = await loadSettings();

  for (const key of Object.keys(LIMITS) as NumberSetting[]) bindNumber(key);
  for (const key of ["liveGroup", "openDiscarded"] as const) bindCheckbox(key);
  bindGroupName();
  bindGroupColor();
  bindBadgeColor();
  renderSectionsTable();
  await bindToken();
}

async function update(patch: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...patch };
  await saveSettings(settings);
}

function bindNumber(key: NumberSetting): void {
  const input = byId<HTMLInputElement>(`${key}-input`);
  const [min, max] = LIMITS[key];
  input.min = String(min);
  input.max = String(max);
  input.value = String(settings[key]);
  input.addEventListener("change", () => {
    const value = clampNumber(input.value, LIMITS[key], DEFAULT_SETTINGS[key]);
    input.value = String(value);
    void update({ [key]: value });
  });
}

function bindCheckbox(key: BooleanSetting): void {
  const input = byId<HTMLInputElement>(`${key}-input`);
  input.checked = settings[key];
  input.addEventListener("change", () => void update({ [key]: input.checked }));
}

function bindGroupName(): void {
  const input = byId<HTMLInputElement>("groupName-input");
  input.value = settings.groupName;
  input.placeholder = DEFAULT_SETTINGS.groupName;
  input.addEventListener("change", () => {
    const groupName = input.value.trim() || DEFAULT_SETTINGS.groupName;
    input.value = groupName;
    void update({ groupName });
  });
}

function bindGroupColor(): void {
  const select = byId<HTMLSelectElement>("groupColor-input");
  select.replaceChildren(
    ...GROUP_COLORS.map((color) => {
      const option = el("option", undefined, msg(`color_${color}`));
      option.value = color;
      return option;
    })
  );
  select.value = settings.groupColor;
  select.addEventListener("change", () => {
    const groupColor = GROUP_COLORS.find((c) => c === select.value) ?? DEFAULT_SETTINGS.groupColor;
    void update({ groupColor });
  });
}

function bindBadgeColor(): void {
  const input = byId<HTMLInputElement>("badgeColor-input");
  input.value = settings.badgeColor;
  input.addEventListener("change", () => void update({ badgeColor: input.value }));
}

function renderSectionsTable(): void {
  const body = byId<HTMLTableSectionElement>("sections-body");
  body.replaceChildren(
    ...SECTION_IDS.map((id) => {
      const row = el("tr");
      row.append(el("th", undefined, msg(`section_${id}`)));
      for (const flag of SECTION_FLAGS) {
        const cell = el("td");
        const input = el("input");
        input.type = "checkbox";
        input.checked = settings.sections[id][flag];
        input.setAttribute("aria-label", `${msg(`section_${id}`)}: ${msg(`flag_${flag}`)}`);
        input.addEventListener("change", () => {
          const sections = { ...settings.sections, [id]: { ...settings.sections[id], [flag]: input.checked } };
          void update({ sections });
        });
        cell.append(input);
        row.append(cell);
      }
      return row;
    })
  );
}

async function bindToken(): Promise<void> {
  const input = byId<HTMLInputElement>("token-input");
  const save = byId<HTMLButtonElement>("token-save");
  const test = byId<HTMLButtonElement>("token-test");
  const remove = byId<HTMLButtonElement>("token-remove");

  const showSaved = async () => {
    const saved = (await loadToken()) !== "";
    byId("token-status").textContent = msg(saved ? "tokenSaved" : "tokenMissing");
    remove.disabled = !saved;
    test.disabled = !saved && input.value.trim() === "";
  };

  input.addEventListener("input", () => {
    save.disabled = input.value.trim() === "";
    void showSaved();
  });
  save.disabled = true;

  save.addEventListener("click", async () => {
    const token = input.value.trim();
    if (!token) return;
    await saveToken(token);
    input.value = "";
    save.disabled = true;
    await showSaved();
    await runCheck(token);
  });

  test.addEventListener("click", async () => {
    await runCheck(input.value.trim() || (await loadToken()));
  });

  remove.addEventListener("click", async () => {
    await saveToken("");
    byId("token-result").textContent = "";
    await showSaved();
  });

  await showSaved();
}

async function runCheck(token: string): Promise<void> {
  const result = byId("token-result");
  result.textContent = msg("tokenChecking");
  result.className = "hint";
  const check = await checkToken(token);
  result.textContent = describeCheck(check);
  result.className = check.ok ? "hint ok" : "hint error";
}

function describeCheck(check: TokenCheck): string {
  if (!check.ok) {
    switch (check.error.kind) {
      case "no-token":
        return msg("tokenMissing");
      case "unauthorized":
        return msg("errorUnauthorized");
      case "rate-limited":
        return msg("errorRateLimited", relativeTime(check.error.until));
      case "network":
        return msg("errorNetwork");
      case "github":
        return msg("errorGithub", check.error.message);
    }
  }
  if (check.scopes === null) return msg("tokenFineGrained", check.login);
  const scopes = check.scopes.join(", ") || msg("tokenNoScopes");
  const missingRepo = !check.scopes.includes("repo");
  return msg("tokenClassic", check.login, scopes) + (missingRepo ? ` ${msg("tokenMissingRepo")}` : "");
}
