// Service workers can't match media queries, so this offscreen document
// reports the browser's colour scheme to the background.
import { COLOR_SCHEME_MESSAGE } from "./color-scheme.ts";

const dark = matchMedia("(prefers-color-scheme: dark)");
const report = () => void chrome.runtime.sendMessage({ type: COLOR_SCHEME_MESSAGE, dark: dark.matches }).catch(() => {});
dark.addEventListener("change", report);
report();
