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

export interface CaptureViewportState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  msgCount: number;
  isBeginning: boolean;
  isRendered: boolean;
  visibleMessageIds: string[];
  layoutSignature: string;
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

// Collects everything the capture engine needs to decide whether a viewport
// is ready and has stopped moving. This function must stay self-contained so
// it can be serialized and run inside Discord by Puppeteer.
export function getCaptureViewportState(doc: Document): CaptureViewportState {
  const chatArea =
    doc.querySelector('[class*="chatContent_"]') ||
    doc.querySelector('[class*="chat_"] > [class*="content_"]');
  const scroller =
    chatArea?.querySelector('[class*="managedReactiveScroller_"]') ||
    doc.querySelector('[class*="managedReactiveScroller_"]') ||
    chatArea;
  if (!scroller) {
    return {
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
      msgCount: 0,
      isBeginning: false,
      isRendered: false,
      visibleMessageIds: [],
      layoutSignature: "missing-scroller",
    };
  }

  const sRect = scroller.getBoundingClientRect();
  const inViewport = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom >= sRect.top && r.top <= sRect.bottom;
  };
  const visibleGroups = Array.from(
    doc.querySelectorAll('[id^="chat-messages-"]')
  ).filter(inViewport);
  const visibleMessageIds = visibleGroups.map((group) => group.id);

  let isRendered = sRect.height > 0 && visibleGroups.length > 0;
  const placeholders = doc.querySelectorAll(
    '[class*="messageGroupBlocker_"], [class*="skeleton"], [aria-busy="true"]'
  );
  for (const placeholder of Array.from(placeholders)) {
    if (inViewport(placeholder)) isRendered = false;
  }

  const mediaState: string[] = [];
  for (const group of visibleGroups) {
    for (const wrapper of Array.from(
      group.querySelectorAll('[class*="imageWrapper_"]')
    )) {
      if (!inViewport(wrapper) || wrapper.querySelector("img")) continue;
      mediaState.push("i:0:missing");
      isRendered = false;
    }
    for (const image of Array.from(group.querySelectorAll("img"))) {
      if (!inViewport(image)) continue;
      const className = image.getAttribute("class") || "";
      const isDiscordPlaceholder = className.includes("imagePlaceholder_");
      if (isDiscordPlaceholder) {
        const isStillVisible = className.includes(
          "imagePlaceholderVisible_"
        );
        mediaState.push(`p:${isStillVisible ? 1 : 0}`);
        if (isStillVisible) isRendered = false;
        // Discord intentionally leaves the hidden low-resolution placeholder
        // beside the decoded real image. It must not block capture.
        continue;
      }

      const source = (image.currentSrc || image.getAttribute("src") || "")
        .trim()
        .toLowerCase();
      const isEmbedPreview = !!image.closest('[class*="embedWrapper_"]');
      const isPlaceholder =
        isEmbedPreview &&
        (source.startsWith("data:") ||
          source.startsWith("blob:") ||
          image.getAttribute("data-loading") === "true" ||
          image.getAttribute("aria-busy") === "true");
      const style = doc.defaultView?.getComputedStyle(image);
      const isVisible =
        style?.visibility !== "hidden" &&
        style?.display !== "none" &&
        Number.parseFloat(style?.opacity || "1") > 0;
      const loaded =
        image.complete &&
        image.naturalWidth > 0 &&
        !isPlaceholder &&
        isVisible;
      mediaState.push(
        `i:${loaded ? 1 : 0}:${isPlaceholder ? 1 : 0}:` +
          `${image.naturalWidth}x${image.naturalHeight}:${source}`
      );
      if (!loaded) isRendered = false;
    }
    for (const video of Array.from(group.querySelectorAll("video[autoplay]"))) {
      if (!inViewport(video)) continue;
      const media = video as HTMLVideoElement;
      const loaded = media.readyState >= 2 || !!media.error;
      mediaState.push(
        `v:${loaded ? 1 : 0}:${media.videoWidth}x${media.videoHeight}`
      );
      if (!loaded) isRendered = false;
    }
  }

  const beginningMarkers = doc.querySelectorAll(
    '[class*="emptyChannelIcon_"], [class*="beginningOfChannel_"]'
  );
  const isBeginning = Array.from(beginningMarkers).some(inViewport);
  const geometry = visibleGroups.map((group) => {
    const r = group.getBoundingClientRect();
    return `${group.id}:${Math.round(r.top)}:${Math.round(r.bottom)}`;
  });

  return {
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    msgCount: doc.querySelectorAll('[id^="chat-messages-"]').length,
    isBeginning,
    isRendered,
    visibleMessageIds,
    layoutSignature: [
      Math.round(scroller.scrollTop),
      scroller.scrollHeight,
      scroller.clientHeight,
      ...geometry,
      ...mediaState,
    ].join("|"),
  };
}

// Move by a predictable amount while retaining overlap between screenshots.
// Assigning scrollTop avoids smooth-scroll timing and keyboard focus issues.
export function scrollChatViewportUp(doc: Document): number {
  const chatArea =
    doc.querySelector('[class*="chatContent_"]') ||
    doc.querySelector('[class*="chat_"] > [class*="content_"]');
  const scroller =
    chatArea?.querySelector('[class*="managedReactiveScroller_"]') ||
    doc.querySelector('[class*="managedReactiveScroller_"]') ||
    chatArea;
  if (!scroller) return 0;

  const before = scroller.scrollTop;
  const distance = Math.max(1, Math.floor(scroller.clientHeight * 0.8));
  scroller.scrollTop = Math.max(0, before - distance);
  return before - scroller.scrollTop;
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
