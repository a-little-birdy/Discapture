// Re-embed the app icon into launcher.exe / bun.exe on Windows.
// electrobun's bundled rcedit module has a path baked at CI time
// (D:\a\electrobun\...) so its own embed step silently fails. Run
// rcedit from the project's local node_modules instead.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

if (process.env.ELECTROBUN_OS !== "win") process.exit(0);

const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const appName = process.env.ELECTROBUN_APP_NAME;
if (!buildDir || !appName) {
  console.error("postbuild: missing ELECTROBUN_BUILD_DIR / ELECTROBUN_APP_NAME");
  process.exit(1);
}

const projectRoot = join(import.meta.dir, "..");
const rcedit = join(projectRoot, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
const icon = join(projectRoot, "src", "assets", "logo.ico");
const binDir = join(buildDir, appName, "bin");

if (!existsSync(rcedit)) {
  console.warn(`postbuild: rcedit not found at ${rcedit}; skipping icon embed`);
  process.exit(0);
}

for (const exe of ["launcher.exe", "bun.exe"]) {
  const target = join(binDir, exe);
  if (!existsSync(target)) continue;
  const r = spawnSync(rcedit, [target, "--set-icon", icon], { stdio: "inherit" });
  if (r.status !== 0) console.warn(`postbuild: rcedit failed for ${exe} (${r.status})`);
  else console.log(`postbuild: embedded icon in ${exe}`);
}
