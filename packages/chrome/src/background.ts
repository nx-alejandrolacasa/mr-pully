import { runBackground } from "@mr-pully/shared/background";
import { isColorSchemeMessage } from "./color-scheme.ts";

runBackground({ minAlarmMs: 30_000 });

function toolbarIcon(dark: boolean): Record<number, string> {
  const variant = dark ? "light" : "dark";
  return { 16: `icons/toolbar-${variant}-16.png`, 32: `icons/toolbar-${variant}-32.png` };
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isColorSchemeMessage(message)) void chrome.action.setIcon({ path: toolbarIcon(message.dark) });
});

void chrome.offscreen
  .createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.MATCH_MEDIA],
    justification: "Match the toolbar icon to the browser's light or dark mode.",
  })
  .catch(() => {});
