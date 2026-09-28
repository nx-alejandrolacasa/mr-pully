// Post-build sanity check. Fails loudly if any expected file is missing
// from dist/ — catches asset-copy regressions that esbuild itself wouldn't
// notice (e.g. accidentally dropping the _locales copy step).
import { existsSync } from "node:fs";
import path from "node:path";

export async function validateDist(
  distDir: string,
  required: readonly string[]
): Promise<void> {
  const missing = required.filter((f) => !existsSync(path.join(distDir, f)));
  if (missing.length > 0) {
    throw new Error(
      `Build output incomplete in ${distDir}:\n  - ${missing.join("\n  - ")}`
    );
  }
}
