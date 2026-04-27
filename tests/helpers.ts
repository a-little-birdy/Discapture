import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { join, resolve } from "path";
import { existsSync } from "fs";

// 1x1 transparent PNG. Used to fulfill image requests from the
// fixture so `img.complete && naturalWidth > 0` evaluates true
// without needing real network access.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

// Mirrors capture-engine's findBrowser() so tests don't need to import
// it from the main module (which pulls in unrelated dependencies).
function findBrowser(): string | null {
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const pf = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const pfx86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localApp = process.env["LOCALAPPDATA"] || "";
    candidates.push(
      join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      join(pfx86, "Google", "Chrome", "Application", "chrome.exe"),
      join(localApp, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(pfx86, "Microsoft", "Edge", "Application", "msedge.exe")
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/usr/bin/microsoft-edge"
    );
  }
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export async function launchTestBrowser(): Promise<Browser> {
  const exe = findBrowser();
  if (!exe) throw new Error("No Chrome/Edge found on this machine");
  return puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

export function fixtureUrl(name: string, query: string = ""): string {
  const abs = resolve(import.meta.dir, "fixtures", name).replace(/\\/g, "/");
  const q = query ? `?${query}` : "";
  // file:/// + absolute path. On Windows path begins with C:; the
  // three slashes make it `file:///C:/...`.
  return `file:///${abs}${q}`;
}

// Inject the source of a pure dom.ts function into the page and
// invoke it against the page's `document`. Mirrors what
// capture-engine.ts does in production.
export async function runInPage<T>(
  page: Page,
  fn: (doc: Document) => T
): Promise<T> {
  return (await page.evaluate(`(${fn.toString()})(document)`)) as T;
}

// Stub out network requests so the fixture's fake image/video URLs
// "succeed" with a 1x1 PNG (or empty body for non-images). Without
// this, Chrome's failed-load state leaves `naturalWidth === 0` and
// the wait-gate predicate returns false.
export async function stubNetwork(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    const url = req.url();
    if (url.startsWith("file://")) {
      // Local fixture asset — let it through.
      req.continue();
      return;
    }
    if (type === "image") {
      req.respond({
        status: 200,
        contentType: "image/png",
        body: TINY_PNG,
      });
      return;
    }
    // Videos and everything else: empty 200 so loaders don't error.
    req.respond({ status: 200, body: "" });
  });
}
