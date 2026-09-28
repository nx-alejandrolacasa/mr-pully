// Write the 128×128 PNG of the extension icon (the same render the Chrome
// build emits into dist/) to packages/shared/assets/icons/icon.png, for the
// store listing upload.
//
// Run via:  node scripts/generate-icon.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderIconPng } from "../packages/shared/src/build-helpers/icon-png.ts";

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages/shared/assets/icons/icon.png"
);

writeFileSync(OUT, renderIconPng());
console.log(`Wrote ${OUT}`);
