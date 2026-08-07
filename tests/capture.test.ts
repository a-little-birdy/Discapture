import { test, expect, beforeAll, afterAll } from "bun:test";
import type { Browser, Page } from "puppeteer-core";
import {
  parseVisibleMessagesFromDOM,
  getCaptureViewportState,
  scrollChatViewportUp,
  stripChromeAndRevealSpoilers,
} from "../src/bun/dom";
import { launchTestBrowser, fixtureUrl, runInPage, stubNetwork } from "./helpers";
import expected from "./fixtures/expected-messages.json";

let browser: Browser;

// First Chrome launch on a cold CI runner can take longer than bun
// test's 5 s default. Per-test timeout is bumped via the CLI flag in
// package.json / CI step.
const HOOK_TIMEOUT_MS = 60_000;

beforeAll(async () => {
  browser = await launchTestBrowser();
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await browser?.close();
}, HOOK_TIMEOUT_MS);

async function loadFixture(query: string = ""): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  await stubNetwork(page);
  await page.goto(fixtureUrl("discord-channel.html", query));
  return page;
}

test("parser produces the expected snapshot for the full fixture", async () => {
  const page = await loadFixture("expand=1");
  try {
    const messages = await runInPage(page, parseVisibleMessagesFromDOM);
    expect(messages).toEqual(expected);
  } finally {
    await page.close();
  }
});

test("parser captures Tenor video, GIPHY image, and CDN anchor URLs", async () => {
  const page = await loadFixture("expand=1");
  try {
    const messages = await runInPage(page, parseVisibleMessagesFromDOM);
    const allUrls = messages.flatMap((m) => m.attachments.map((a) => a.url));
    expect(allUrls).toContain("https://media.tenor.com/abc123XYZ/funny-cat.mp4");
    expect(allUrls).toContain("https://media.giphy.com/media/static-id/giphy.gif");
    expect(allUrls).toContain(
      "https://cdn.discordapp.com/attachments/123/789/document.pdf"
    );
    expect(allUrls).toContain(
      "https://cdn.discordapp.com/attachments/999/111/clip.mp4"
    );
  } finally {
    await page.close();
  }
});

test("parser carries author/timestamp across same-author message runs", async () => {
  const page = await loadFixture("expand=1");
  try {
    const messages = await runInPage(page, parseVisibleMessagesFromDOM);
    const m1 = messages.find((m) => m.id === "chat-messages-1001")!;
    const m2 = messages.find((m) => m.id === "chat-messages-1002")!;
    expect(m1.author).toBe("alice");
    // m2 has no <username_> in its DOM but should inherit alice from m1
    expect(m2.author).toBe("alice");
    expect(m2.timestamp).toBe(m1.timestamp);
  } finally {
    await page.close();
  }
});

test("parser respects scroller viewport — small viewport clips message list", async () => {
  // No expand: scroller is its default 600px tall, so only the
  // top messages overlap the viewport.
  const page = await loadFixture();
  try {
    const messages = await runInPage(page, parseVisibleMessagesFromDOM);
    expect(messages.length).toBeLessThan(expected.length);
    expect(messages.length).toBeGreaterThan(0);
  } finally {
    await page.close();
  }
});

test("capture viewport is ready when fixture is fully rendered", async () => {
  const page = await loadFixture("expand=1");
  try {
    const state = await runInPage(page, getCaptureViewportState);
    expect(state.isRendered).toBe(true);
  } finally {
    await page.close();
  }
});

test("capture viewport is not ready when dominated by skeletons", async () => {
  // slow=99999 leaves the skeletons in place for the duration of the
  // test, so the predicate should return false.
  const page = await loadFixture("slow=99999");
  try {
    // Give the slow-load script a moment to swap skeletons in.
    await new Promise((r) => setTimeout(r, 100));
    const state = await runInPage(page, getCaptureViewportState);
    expect(state.isRendered).toBe(false);
  } finally {
    await page.close();
  }
});

test("capture viewport is not ready when an image has not attached", async () => {
  const page = await loadFixture("expand=1");
  try {
    // Strip the <img> from the image wrapper to simulate Discord's
    // lazy-attach behavior before pixels arrive.
    await page.evaluate(() => {
      const wrapper = document.querySelector('[class*="imageWrapper_"]');
      wrapper?.querySelector("img")?.remove();
    });
    const state = await runInPage(page, getCaptureViewportState);
    expect(state.isRendered).toBe(false);
  } finally {
    await page.close();
  }
});

test("capture viewport accepts short and media-only messages", async () => {
  const page = await loadFixture("expand=1");
  try {
    await page.evaluate(() => {
      document
        .querySelectorAll('[id^="message-content-"]')
        .forEach((content) => (content.textContent = "ok"));
      document.querySelector('[id^="message-content-"]')!.textContent = "";
    });
    const state = await runInPage(page, getCaptureViewportState);
    expect(state.isRendered).toBe(true);
  } finally {
    await page.close();
  }
});

test("capture viewport follows Discord's visible placeholder state", async () => {
  const page = await loadFixture("expand=1");
  try {
    await page.evaluate(() => {
      const realImage = document.querySelector(
        '[class*="embedWrapper_"] img'
      ) as HTMLImageElement;
      const placeholder = document.createElement("img");
      placeholder.className =
        "imagePlaceholder_test imagePlaceholderVisible_test";
      placeholder.src =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"></svg>'
        );
      realImage.parentElement!.appendChild(placeholder);
    });
    await page.waitForFunction(
      () =>
        (
          document.querySelector(
            '[class*="imagePlaceholderVisible_"]'
          ) as HTMLImageElement
        ).complete
    );

    const loading = await runInPage(page, getCaptureViewportState);
    expect(loading.isRendered).toBe(false);

    await page.evaluate(() => {
      const placeholder = document.querySelector(
        '[class*="imagePlaceholderVisible_"]'
      )!;
      placeholder.className =
        "imagePlaceholder_test imagePlaceholderHidden_test";
    });
    const loaded = await runInPage(page, getCaptureViewportState);
    expect(loaded.isRendered).toBe(true);
  } finally {
    await page.close();
  }
});

test("capture viewport state exposes a stable visible-message signature", async () => {
  const page = await loadFixture();
  try {
    const state = await runInPage(page, getCaptureViewportState);
    expect(state.isRendered).toBe(true);
    expect(state.visibleMessageIds.length).toBeGreaterThan(0);
    expect(state.layoutSignature).toContain(state.visibleMessageIds[0]);
  } finally {
    await page.close();
  }
});

test("scrollChatViewportUp moves the chat scroller by 80% with overlap", async () => {
  const page = await loadFixture();
  try {
    const before = await page.evaluate(() => {
      const scroller = document.getElementById("scroller")!;
      scroller.style.height = "250px";
      scroller.scrollTop = scroller.scrollHeight;
      return {
        scrollTop: scroller.scrollTop,
        clientHeight: scroller.clientHeight,
      };
    });
    const movedBy = await runInPage(page, scrollChatViewportUp);
    const after = await page.evaluate(
      () => document.getElementById("scroller")!.scrollTop
    );

    expect(movedBy).toBe(Math.floor(before.clientHeight * 0.8));
    expect(after).toBe(before.scrollTop - movedBy);
  } finally {
    await page.close();
  }
});

test("capture state blocks during slow load and resolves once content arrives", async () => {
  // slow=200 gives ~9 swaps × 200ms ≈ 1.8s before all content is in.
  const page = await loadFixture("slow=200&expand=1");
  try {
    const start = Date.now();
    await page.waitForFunction(
      `(${getCaptureViewportState.toString()})(document).isRendered`,
      { timeout: 15000, polling: 100 }
    );
    const elapsed = Date.now() - start;

    // Must have actually waited (not passed instantly).
    expect(elapsed).toBeGreaterThan(300);
    // And resolved well within the timeout.
    expect(elapsed).toBeLessThan(15000);
  } finally {
    await page.close();
  }
});

test("stripChromeAndRevealSpoilers removes typing, unread, and jump-to-present", async () => {
  const page = await loadFixture("expand=1");
  try {
    // Pre-condition: all three are present in the fixture.
    const before = await page.evaluate(() => ({
      typing: !!document.querySelector('[class*="typing_"]'),
      unread: !!document.querySelector(
        '[id^="NewMessagesBarJumpToNewMessages_"]'
      ),
      jump: !!document.querySelector('[class*="jumpToPresentBar_"]'),
    }));
    expect(before).toEqual({ typing: true, unread: true, jump: true });

    await runInPage(page, stripChromeAndRevealSpoilers);

    const after = await page.evaluate(() => ({
      typing: !!document.querySelector('[class*="typing_"]'),
      unread: !!document.querySelector(
        '[id^="NewMessagesBarJumpToNewMessages_"]'
      ),
      jump: !!document.querySelector('[class*="jumpToPresentBar_"]'),
      // The unread bar's wrapping div should also be gone.
      unreadBarWrapper: !!document.querySelector(
        '[class*="newMessagesBar_"]'
      ),
    }));
    expect(after).toEqual({
      typing: false,
      unread: false,
      jump: false,
      unreadBarWrapper: false,
    });
  } finally {
    await page.close();
  }
});

test("stripChromeAndRevealSpoilers preserves real message groups", async () => {
  const page = await loadFixture("expand=1");
  try {
    const before = await page.evaluate(
      () => document.querySelectorAll('[id^="chat-messages-"]').length
    );
    await runInPage(page, stripChromeAndRevealSpoilers);
    const after = await page.evaluate(
      () => document.querySelectorAll('[id^="chat-messages-"]').length
    );
    expect(after).toBe(before);
  } finally {
    await page.close();
  }
});
