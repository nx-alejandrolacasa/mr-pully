// packages/firefox/build.ts — esbuild + static copy + manifest version stamp.
//
// Run via:  npx tsx build.ts            (one-shot build)
//           npx tsx build.ts --watch    (rebuild on file change)
//
// Output: ./dist/, a fully-self-contained Firefox-loadable extension dir.
import { build, context, type BuildOptions } from "esbuild";
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDist } from "../shared/src/build-helpers/validate-dist.ts";

const REQUIRED_DIST_FILES = [
  "manifest.json",
  "popup.html",
  "popup.js",
  "options.html",
  "options.js",
  "styles.css",
  "background.js",
  "_locales/en/messages.json",
  "icons/icon.svg",
] as const;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const SHARED_DIR = path.resolve(REPO_ROOT, "packages", "shared");
const DIST = path.join(HERE, "dist");
const WATCH = process.argv.includes("--watch");
const DEV = WATCH || process.env.NODE_ENV !== "production";

async function readSharedVersion(): Promise<string> {
  const { version } = JSON.parse(
    await readFile(path.join(SHARED_DIR, "package.json"), "utf8")
  );
  return version;
}

async function copyAssets(version: string) {
  const sharedAssets = path.join(SHARED_DIR, "assets");
  const sharedLocales = path.join(SHARED_DIR, "_locales");

  for (const f of ["popup.html", "options.html", "styles.css"]) {
    await cp(path.join(sharedAssets, f), path.join(DIST, f));
  }
  await cp(path.join(sharedAssets, "icons"), path.join(DIST, "icons"), {
    recursive: true,
  });
  await cp(sharedLocales, path.join(DIST, "_locales"), { recursive: true });

  const manifest = JSON.parse(await readFile(path.join(HERE, "manifest.json"), "utf8"));
  manifest.version = version;
  await writeFile(
    path.join(DIST, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
}

function bundleOptions(entry: string, outfile: string): BuildOptions {
  return {
    entryPoints: [path.join(HERE, "src", entry)],
    outfile: path.join(DIST, outfile),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["firefox142"],
    sourcemap: DEV ? "inline" : false,
    minify: !DEV,
    logLevel: "info",
  };
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const version = await readSharedVersion();
  await copyAssets(version);

  const bundles = [
    bundleOptions("popup.ts", "popup.js"),
    bundleOptions("options.ts", "options.js"),
    bundleOptions("background.ts", "background.js"),
  ];

  if (WATCH) {
    const contexts = await Promise.all(bundles.map((opts) => context(opts)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("esbuild watching… (Ctrl+C to exit)");
  } else {
    await Promise.all(bundles.map((opts) => build(opts)));
    await validateDist(DIST, REQUIRED_DIST_FILES);
    console.log(`Built @mr-pully/firefox v${version} → ${path.relative(REPO_ROOT, DIST)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
