// Pure DOM-mutation / inspection functions used by the capture
// engine. These are written to take an explicit `doc: Document`
// argument so they can be invoked both:
//
//   1. inside a real browser via puppeteer:
//      `page.evaluate(`(${fn.toString()})(document)`)`
//   2. inside a fixture-loaded jsdom/happy-dom for tests.
//
// They must remain self-contained — no closures over outer-scope
// state, no imports from npm packages — so that `fn.toString()`
// produces a body the browser can execute as-is.

export interface RawMessage {
  id: string;
  author: string;
  timestamp: string;
  content: string;
  attachments: { url: string }[];
  embeds: string[];
}

// Parses every `[id^="chat-messages-"]` group inside the chat scroller
// that intersects the scroller's visible viewport. Username and
// timestamp carry across same-author groupings (Discord renders the
// author header only on the first message of a run).
export function parseVisibleMessagesFromDOM(doc: Document): RawMessage[] {
  const chatArea =
    doc.querySelector('[class*="chatContent_"]') ||
    doc.querySelector('[class*="chat_"] > [class*="content_"]');
  if (!chatArea) return [];

  const scroller =
    doc.querySelector('[class*="managedReactiveScroller_"]') || chatArea;
  const scrollerRect = scroller.getBoundingClientRect();

  const groups = chatArea.querySelectorAll('[id^="chat-messages-"]');
  const messages: RawMessage[] = [];
  let currentAuthor = "";
  let currentTimestamp = "";

  groups.forEach((group) => {
    const rect = group.getBoundingClientRect();
    if (rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) {
      return;
    }
    const usernameEl = group.querySelector('[class*="username_"]');
    const timeEl = group.querySelector("time");

    if (usernameEl)
      currentAuthor = usernameEl.textContent?.trim() || currentAuthor;
    if (timeEl)
      currentTimestamp =
        timeEl.getAttribute("datetime") ||
        timeEl.textContent?.trim() ||
        currentTimestamp;

    const contentEl = group.querySelector('[id^="message-content-"]');
    const content = contentEl?.textContent?.trim() || "";

    const urls: string[] = [];
    const pushUrl = (u: string) => {
      if (u && !urls.includes(u)) urls.push(u);
    };

    group
      .querySelectorAll(
        'a[href*="cdn.discordapp.com"], a[href*="media.discordapp.net"], a[class*="fileNameLink_"]'
      )
      .forEach((a: Element) => {
        pushUrl((a as HTMLAnchorElement).href || a.getAttribute("href") || "");
      });

    group
      .querySelectorAll(
        '[class*="imageWrapper_"] img, [class*="attachment_"] img, [class*="embedWrapper_"] img'
      )
      .forEach((img: Element) => {
        pushUrl((img as HTMLImageElement).src);
      });

    group.querySelectorAll("video").forEach((v: Element) => {
      const vid = v as HTMLVideoElement;
      pushUrl(vid.src);
      pushUrl(vid.currentSrc);
      v.querySelectorAll("source").forEach((s: Element) => {
        pushUrl(s.getAttribute("src") || "");
      });
    });

    const embeds: string[] = [];
    group.querySelectorAll('[class*="embedWrapper_"]').forEach((e: Element) => {
      const text = e.textContent?.trim() || "";
      if (text) embeds.push(text);
    });

    messages.push({
      id:
        group.id ||
        `${currentAuthor}-${currentTimestamp}-${content.slice(0, 50)}`,
      author: currentAuthor,
      timestamp: currentTimestamp,
      content,
      attachments: urls.map((url) => ({ url })),
      embeds,
    });
  });

  return messages;
}

// Coverage-based readiness check: returns true once the visible
// viewport of the chat scroller is mostly rendered.
//
// Sums the heights of `[id^="chat-messages-"]` groups whose content
// has text, clipped to the scroller's on-screen rect; passes when the
// sum is >= 70% of the viewport height. Skeleton rows lack the
// `chat-messages-` ID, so they contribute zero by construction.
//
// Also requires every visible `[class*="imageWrapper_"]` to have a
// fully-loaded `<img>`; Discord lazy-attaches the img tag only once
// bytes arrive.
//
// Beginning-of-channel: when `emptyChannelIcon_`/`beginningOfChannel_`
// is present, the threshold drops to "any rendered content" since
// the chat may not fill the viewport.
export function isViewportRendered(doc: Document): boolean {
  const scroller =
    doc.querySelector('[class*="managedReactiveScroller_"]') ||
    doc.querySelector('[class*="chatContent_"]');
  if (!scroller) return false;
  const sRect = scroller.getBoundingClientRect();
  const sHeight = sRect.height;
  if (sHeight <= 0) return false;

  const inViewport = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom >= sRect.top && r.top <= sRect.bottom;
  };

  let coveredHeight = 0;
  const groups = doc.querySelectorAll('[id^="chat-messages-"]');
  for (const g of groups) {
    const r = g.getBoundingClientRect();
    const top = Math.max(r.top, sRect.top);
    const bottom = Math.min(r.bottom, sRect.bottom);
    if (bottom <= top) continue;
    const c = g.querySelector('[id^="message-content-"]');
    if (!c) continue;
    if ((c.textContent?.trim().length || 0) <= 5) continue;
    coveredHeight += bottom - top;
  }

  const atBeginning = !!(
    doc.querySelector('[class*="emptyChannelIcon_"]') ||
    doc.querySelector('[class*="beginningOfChannel_"]')
  );
  const minCoverage = atBeginning ? 1 : sHeight * 0.7;
  if (coveredHeight < minCoverage) return false;

  const wrappers = doc.querySelectorAll('[class*="imageWrapper_"]');
  for (const w of wrappers) {
    if (!inViewport(w)) continue;
    const img = w.querySelector("img");
    if (!img) return false;
    if (!img.complete || img.naturalWidth === 0) return false;
  }
  return true;
}

// Pre-screenshot DOM hygiene: clicks all spoiler reveals, removes the
// jump-to-present bar, the typing indicator ("X is typing..."), and
// the unread-messages bar. Returns the number of spoilers that were
// clicked (so the caller can decide whether to wait for them to
// animate in).
export function stripChromeAndRevealSpoilers(doc: Document): number {
  const spoilers = doc.querySelectorAll('[aria-label="Spoiler"]');
  spoilers.forEach((el) => (el as HTMLElement).click());

  doc
    .querySelectorAll('[class*="jumpToPresentBar_"]')
    .forEach((el) => el.remove());

  // Match both modern (`typing_`) and legacy (`typing-`) class forms,
  // then verify by text content so we don't strip something that
  // merely happens to contain "typing" in its class name.
  doc
    .querySelectorAll('[class*="typing_"], [class^="typing-"]')
    .forEach((el) => {
      const txt = (el.textContent || "").toLowerCase();
      if (txt.includes("typing")) el.remove();
    });

  // Walk up from the unread-bar span to the nearest button/bar
  // wrapper and strip that. Fall back to the span itself if no
  // wrapper found.
  doc
    .querySelectorAll('[id^="NewMessagesBarJumpToNewMessages_"]')
    .forEach((span) => {
      const bar = span.closest(
        'button, [role="button"], [class*="bar_"], [class*="Bar_"]'
      );
      (bar || span).remove();
    });

  return spoilers.length;
}
