// Workaround for electrobun's npm postinstall on Windows.
// The shipped bin/electrobun.cjs invokes `tar -xzf "C:\..."` which GNU/bsdtar
// interpret as a remote host. We download + extract with a relative path instead.

import { mkdir, rm } from "node:fs/promises";
import { existsSync, copyFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const platform =
  process.platform === "win32" ? "win" : process.platform === "darwin" ? "darwin" : "linux";
const arch = platform === "win" ? "x64" : process.arch === "arm64" ? "arm64" : "x64";
const binExt = platform === "win" ? ".exe" : "";

const electrobunDir = join(import.meta.dir, "..", "node_modules", "electrobun");
const binPath = join(electrobunDir, "bin", `electrobun${binExt}`);

if (existsSync(binPath)) process.exit(0);

const pkg = await Bun.file(join(electrobunDir, "package.json")).json();
const url = `https://github.com/blackboardsh/electrobun/releases/download/v${pkg.version}/electrobun-cli-${platform}-${arch}.tar.gz`;
const cacheDir = join(electrobunDir, ".cache");
const tarRelative = `electrobun-cli-${platform}-${arch}.tar.gz`;
const tarPath = join(cacheDir, tarRelative);

await mkdir(cacheDir, { recursive: true });
await mkdir(dirname(binPath), { recursive: true });

console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
await Bun.write(tarPath, res);

const result = spawnSync("tar", ["-xzf", tarRelative], { cwd: cacheDir, stdio: "inherit" });
if (result.status !== 0) throw new Error(`tar extraction failed: ${result.status}`);

await rm(tarPath, { force: true });

const extracted = join(cacheDir, `electrobun${binExt}`);
if (!existsSync(extracted)) throw new Error(`CLI binary not found at ${extracted}`);

copyFileSync(extracted, binPath);
if (platform !== "win") chmodSync(binPath, 0o755);

console.log(`electrobun CLI installed at ${binPath}`);
