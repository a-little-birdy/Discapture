// One-shot helper: runs the parser against the fully-rendered fixture
// and writes tests/fixtures/expected-messages.json. Re-run any time
// the fixture HTML changes intentionally.
//
//   bun run tests/generate-snapshot.ts

import { parseVisibleMessagesFromDOM } from "../src/bun/dom";
import { launchTestBrowser, fixtureUrl, runInPage } from "./helpers";
import { join } from "path";

const browser = await launchTestBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  await page.goto(fixtureUrl("discord-channel.html", "expand=1"));
  const messages = await runInPage(page, parseVisibleMessagesFromDOM);
  const out = join(import.meta.dir, "fixtures", "expected-messages.json");
  await Bun.write(out, JSON.stringify(messages, null, 2) + "\n");
  console.log(`Wrote ${out} — ${messages.length} messages`);
} finally {
  await browser.close();
}
