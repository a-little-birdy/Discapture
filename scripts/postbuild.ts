// Windows post-build:
//   1. Re-embed the app icon into launcher.exe / bun.exe. electrobun's
//      bundled rcedit module has a path baked at CI time
//      (D:\a\electrobun\...) so its own embed step silently fails. Run
//      rcedit from the project's local node_modules instead.
//   2. Patch bun.exe's PE Subsystem field from CUI (3) to GUI (2) so
//      Windows doesn't allocate a console window when launcher spawns
//      it. Logs are redirected to a file from src/bun/index.ts.

import { existsSync, openSync, readSync, writeSync, closeSync } from "node:fs";
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

// Flip bun.exe Subsystem from IMAGE_SUBSYSTEM_WINDOWS_CUI (3) to
// IMAGE_SUBSYSTEM_WINDOWS_GUI (2). PE layout: e_lfanew at file offset
// 0x3C (uint32 LE) -> PE header start. Subsystem is uint16 LE at
// PE header + 0x5C (same offset for PE32 and PE32+).
const bunExe = join(binDir, "bun.exe");
if (existsSync(bunExe)) {
  const fd = openSync(bunExe, "r+");
  try {
    const lfanew = Buffer.alloc(4);
    readSync(fd, lfanew, 0, 4, 0x3c);
    const peOff = lfanew.readUInt32LE(0);
    const subOff = peOff + 0x5c;
    const sub = Buffer.alloc(2);
    readSync(fd, sub, 0, 2, subOff);
    if (sub.readUInt16LE(0) === 3) {
      writeSync(fd, Buffer.from([0x02, 0x00]), 0, 2, subOff);
      console.log("postbuild: patched bun.exe subsystem CUI -> GUI");
    } else {
      console.log(`postbuild: bun.exe subsystem already ${sub.readUInt16LE(0)}; skipping patch`);
    }
  } finally {
    closeSync(fd);
  }
}
