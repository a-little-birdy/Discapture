// Runs after `electrobun build` completes (chained from package.json,
// not via electrobun's postBuild hook — that hook fires before
// Resources/version.json is written, and we need to patch it).
//
// Windows-only work:
//   1. Re-embed the app icon into launcher.exe / bun.exe. electrobun's
//      bundled rcedit module has a path baked at CI time
//      (D:\a\electrobun\...) so its own embed step silently fails. Run
//      rcedit from the project's local node_modules instead.
//   2. Rewrite Resources/version.json's `channel` from "dev" to
//      "stable". On Windows the launcher reads this file and, when
//      channel == "dev", spawns bun.exe with inherited stdio (which
//      attaches a console window to the GUI app). Stable -> launcher
//      uses CreateProcessW with CREATE_NO_WINDOW: no console.
//      We can't use `electrobun build --env=stable` because that
//      triggers tar.zst + self-extractor packaging incompatible with
//      our Inno Setup flow.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") process.exit(0);

const projectRoot = join(import.meta.dir, "..");
const bundleDir = join(projectRoot, "build", "dev-win-x64", "Discapture-dev");

if (!existsSync(bundleDir)) {
  console.error(`postbuild: build folder not found at ${bundleDir}`);
  process.exit(1);
}

const rcedit = join(projectRoot, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
const icon = join(projectRoot, "src", "assets", "logo.ico");
const binDir = join(bundleDir, "bin");

if (existsSync(rcedit)) {
  for (const exe of ["launcher.exe", "bun.exe"]) {
    const target = join(binDir, exe);
    if (!existsSync(target)) continue;
    const r = spawnSync(rcedit, [target, "--set-icon", icon], { stdio: "inherit" });
    if (r.status !== 0) console.warn(`postbuild: rcedit failed for ${exe} (${r.status})`);
    else console.log(`postbuild: embedded icon in ${exe}`);
  }
} else {
  console.warn(`postbuild: rcedit not found at ${rcedit}; skipping icon embed`);
}

const versionJsonPath = join(bundleDir, "Resources", "version.json");
if (existsSync(versionJsonPath)) {
  const meta = JSON.parse(readFileSync(versionJsonPath, "utf8"));
  if (meta.channel !== "stable") {
    meta.channel = "stable";
    writeFileSync(versionJsonPath, JSON.stringify(meta));
    console.log("postbuild: set version.json channel -> stable (suppresses console window)");
  }
}
