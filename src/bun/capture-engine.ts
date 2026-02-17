import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { FileStorage, type CaptureSession } from "./file-storage";
import { join } from "path";
import { existsSync } from "fs";

interface Attachment {
  url: string;
  localFile?: string;
}

interface ParsedMessage {
  id: string;
  author: string;
  timestamp: string;
  content: string;
  attachments: Attachment[];
  embeds: string[];
}

type ProgressCallback = (data: {
  screenshotCount: number;
  messageCount: number;
  status: string;
}) => void;

type CompleteCallback = (data: {
  sessionId: string;
  outputPath: string;
  messageCount: number;
  screenshotCount: number;
}) => void;

type ErrorCallback = (data: { message: string }) => void;
type ReadyCallback = () => void;

// Find Chrome or Edge on the system
function findBrowser(): string | null {
  const candidates: string[] = [];

  if (process.platform === "win32") {
    const pf = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const pfx86 =
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
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

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export class CaptureEngine {
  private storage: FileStorage;
  private isRunning = false;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private session: CaptureSession | null = null;
  private screenshotCount = 0;
  private allMessages: ParsedMessage[] = [];
  private seenMessageIds = new Set<string>();

  // Callbacks stored from setup so beginCapture can use them
  private sendProgress: ProgressCallback | null = null;
  private sendComplete: CompleteCallback | null = null;
  private sendError: ErrorCallback | null = null;
  private format: string = "json";

  constructor(storage: FileStorage) {
    this.storage = storage;
  }

  /**
   * Phase 1: Launch browser, navigate to Discord, wait for chat, highlight it.
   * Returns once the chat area is detected and highlighted, so the user can
   * click "Begin Recording" in the control panel.
   */
  async setup(
    config: { format: string },
    sendProgress: ProgressCallback,
    sendComplete: CompleteCallback,
    sendError: ErrorCallback,
    sendReady: ReadyCallback
  ): Promise<{ success: boolean; error?: string }> {
    if (this.browser) {
      return { success: false, error: "Browser already open" };
    }

    // Find a browser
    const executablePath = findBrowser();
    if (!executablePath) {
      return {
        success: false,
        error:
          "Chrome or Edge not found. Please install Chrome or Microsoft Edge.",
      };
    }
    console.log(`[capture] Using browser: ${executablePath}`);

    // Store callbacks for later use in beginCapture
    this.sendProgress = sendProgress;
    this.sendComplete = sendComplete;
    this.sendError = sendError;
    this.format = config.format;

    // Persistent profile so Discord login survives between sessions
    const homeDir = process.env.USERPROFILE || process.env.HOME || ".";
    const userDataDir = join(homeDir, "Documents", "Dispatch", "discord-profile");

    try {
      sendProgress({
        screenshotCount: 0,
        messageCount: 0,
        status: "Launching browser...",
      });

      this.browser = await puppeteer.launch({
        executablePath,
        headless: false,
        userDataDir,
        defaultViewport: null,
        args: [
          "--window-size=1400,900",
          "--disable-blink-features=AutomationControlled",
        ],
      });

      const pages = await this.browser.pages();
      this.page = pages[0] || (await this.browser.newPage());

      // Navigate to Discord
      sendProgress({
        screenshotCount: 0,
        messageCount: 0,
        status: "Loading Discord...",
      });

      await this.page.goto("https://discord.com/app", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      console.log("[capture] Discord loaded");

      // Wait for the chat area to appear
      sendProgress({
        screenshotCount: 0,
        messageCount: 0,
        status: "Waiting for chat to load... Navigate to a channel in the browser window.",
      });

      await this.waitForChat();
      console.log("[capture] Chat area detected");

      sendProgress({
        screenshotCount: 0,
        messageCount: 0,
        status: "Chat area detected! Click Begin Recording when ready.",
      });

      // Tell the UI we're ready
      sendReady();

      return { success: true };
    } catch (err: any) {
      console.error("[capture] Setup error:", err.message);
      sendError({ message: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Phase 2: Start the actual capture (called when user clicks "Begin Recording").
   */
  async beginCapture(): Promise<{ success: boolean; sessionId: string; error?: string }> {
    if (!this.page || !this.browser) {
      return { success: false, sessionId: "", error: "Browser not ready. Click Start Capture first." };
    }
    if (this.isRunning) {
      return { success: false, sessionId: "", error: "Capture already in progress" };
    }

    const sendProgress = this.sendProgress!;
    const sendComplete = this.sendComplete!;
    const sendError = this.sendError!;

    this.isRunning = true;
    this.screenshotCount = 0;
    this.allMessages = [];
    this.seenMessageIds = new Set();

    try {
      // Create output session
      this.session = this.storage.createSession(this.format);
      console.log(`[capture] Session: ${this.session.outputDir}`);

      sendProgress({
        screenshotCount: 0,
        messageCount: 0,
        status: "Capturing...",
      });

      // Run the capture loop
      await this.captureLoop(sendProgress);

      // Download attachments and map URLs to local files
      const allUrls = [
        ...new Set(this.allMessages.flatMap((m) => m.attachments.map((a) => a.url))),
      ];
      if (allUrls.length > 0) {
        sendProgress({
          screenshotCount: this.screenshotCount,
          messageCount: this.allMessages.length,
          status: `Downloading ${allUrls.length} attachments...`,
        });
        const urlToFile = await this.storage.downloadAttachments(
          this.session,
          allUrls,
          (downloaded, total) => {
            sendProgress({
              screenshotCount: this.screenshotCount,
              messageCount: this.allMessages.length,
              status: `Downloading attachments... (${downloaded}/${total})`,
            });
          }
        );
        console.log(`[capture] Downloaded ${urlToFile.size}/${allUrls.length} attachments`);

        // Add local file references to each message's attachments
        for (const msg of this.allMessages) {
          for (const att of msg.attachments) {
            att.localFile = urlToFile.get(att.url);
          }
        }
      }

      // Save the log
      await this.storage.saveLog(this.session, this.allMessages);
      console.log(`[capture] Log saved: ${this.allMessages.length} messages`);

      this.isRunning = false;

      sendComplete({
        sessionId: this.session.id,
        outputPath: this.session.outputDir,
        messageCount: this.allMessages.length,
        screenshotCount: this.screenshotCount,
      });

      return { success: true, sessionId: this.session.id };
    } catch (err: any) {
      this.isRunning = false;
      console.error("[capture] Error:", err.message);
      sendError({ message: err.message });

      // Save whatever we have so far
      if (this.session && this.allMessages.length > 0) {
        await this.storage.saveLog(this.session, this.allMessages);
        console.log(
          `[capture] Partial log saved: ${this.allMessages.length} messages`
        );
      }

      return { success: false, sessionId: "", error: err.message };
    }
  }



  private async waitForChat(): Promise<void> {
    if (!this.page) throw new Error("No page");

    const chatSelectors = [
      '[class*="chatContent_"]',
      '[class*="chat_"] > [class*="content_"]',
    ];

    const timeout = 300000; // 5 minutes
    const start = Date.now();

    while (Date.now() - start < timeout) {
      for (const sel of chatSelectors) {
        const el = await this.page.$(sel);
        if (el) return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    throw new Error(
      "Chat area not found. Make sure you're logged into Discord and on a channel."
    );
  }

  private async parseVisibleMessages(): Promise<ParsedMessage[]> {
    if (!this.page) return [];

    return await this.page.evaluate(() => {
      const chatArea =
        document.querySelector('[class*="chatContent_"]') ||
        document.querySelector('[class*="chat_"] > [class*="content_"]');
      if (!chatArea) return [];

      const groups = chatArea.querySelectorAll('[id^="chat-messages-"]');
      const messages: Array<{
        id: string;
        author: string;
        timestamp: string;
        content: string;
        attachments: { url: string }[];
        embeds: string[];
      }> = [];
      let currentAuthor = "";
      let currentTimestamp = "";

      groups.forEach((group) => {
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
        group
          .querySelectorAll(
            'a[href*="cdn.discordapp.com"], a[href*="media.discordapp.net"], a[class*="fileNameLink_"]'
          )
          .forEach((a: Element) => {
            const href =
              (a as HTMLAnchorElement).href || a.getAttribute("href") || "";
            if (href) urls.push(href);
          });
        group
          .querySelectorAll('[class*="imageWrapper_"] img, [class*="attachment_"] img')
          .forEach((img: Element) => {
            const src = (img as HTMLImageElement).src || "";
            if (src && !urls.includes(src)) urls.push(src);
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
    });
  }

  private async takeScreenshot(): Promise<void> {
    if (!this.page || !this.session) return;

    this.screenshotCount++;
    const screenshotPath = join(
      this.session.outputDir,
      "screenshots",
      `screenshot-${String(this.screenshotCount).padStart(4, "0")}.png`
    );

    try {
      // Use page.screenshot() to avoid element.screenshot() scrolling into view
      await this.page.screenshot({ path: screenshotPath });
    } catch (e: any) {
      console.log(`[capture] Screenshot failed: ${e.message}`);
      this.screenshotCount--;
    }
  }

  private accumulateMessages(messages: ParsedMessage[]): void {
    for (const msg of messages) {
      if (!this.seenMessageIds.has(msg.id)) {
        this.seenMessageIds.add(msg.id);
        this.allMessages.push(msg);
      }
    }
  }

  private async getScrollState(): Promise<{
    scrollTop: number;
    scrollHeight: number;
    msgCount: number;
    isBeginning: boolean;
  }> {
    if (!this.page) return { scrollTop: 0, scrollHeight: 0, msgCount: 0, isBeginning: false };

    return await this.page.evaluate(() => {
      const scroller =
        document.querySelector('[class*="managedReactiveScroller_"]') ||
        document.querySelector('[class*="scroller_"][class*="auto_"]');
      if (!scroller) return { scrollTop: 0, scrollHeight: 0, msgCount: 0, isBeginning: false };

      const isBeginning = !!(
        document.querySelector('[class*="emptyChannelIcon_"]') ||
        document.querySelector('[class*="beginningOfChannel_"]')
      );

      return {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        msgCount: document.querySelectorAll('[id^="chat-messages-"]').length,
        isBeginning,
      };
    });
  }

  private async captureLoop(sendProgress: ProgressCallback): Promise<void> {
    if (!this.page || !this.session) return;

    // --- Wait for messages to fully render with actual text content ---
    console.log("[capture] Waiting for messages to render...");
    try {
      await this.page.waitForFunction(
        () => {
          const msgs = document.querySelectorAll('[id^="message-content-"]');
          if (msgs.length < 2) return false;
          return Array.from(msgs).some(
            (m) => (m.textContent?.trim().length || 0) > 5
          );
        },
        { timeout: 30000 }
      );
      console.log("[capture] Messages with text content detected");
    } catch {
      console.log("[capture] Timed out waiting for message text, continuing anyway");
    }
    // Wait for avatars/images/embeds to load
    await new Promise((r) => setTimeout(r, 3000));

    // --- Initial capture: screenshot the bottom of the chat BEFORE any scrolling ---
    console.log("[capture] Taking initial screenshot at bottom...");
    const initialMessages = await this.parseVisibleMessages();
    this.accumulateMessages(initialMessages);
    await this.takeScreenshot();

    console.log(
      `[capture] Initial capture: ${initialMessages.length} visible, ${this.allMessages.length} total, screenshot #${this.screenshotCount}`
    );

    sendProgress({
      screenshotCount: this.screenshotCount,
      messageCount: this.allMessages.length,
      status: `Capturing... (${this.allMessages.length} messages, ${this.screenshotCount} screenshots)`,
    });

    // --- Focus the message input for PageUp scrolling ---
    const textBox = await this.page.$('div[role="textbox"]');
    if (textBox) {
      await textBox.click();
      console.log("[capture] Focused message input for PageUp scrolling");
    }

    // --- Scroll loop: PageUp, wait, capture, repeat ---
    let stuckCount = 0;

    while (this.isRunning) {
      // 1. Record state before scrolling
      const beforeScroll = await this.getScrollState();

      // 2. Scroll up with PageUp
      await this.page.keyboard.press("PageUp");
      console.log(`[capture] PageUp (was scrollTop: ${beforeScroll.scrollTop})`);

      // 3. Wait for Discord to finish scrolling and load content
      await new Promise((r) => setTimeout(r, 500));

      // 4. Parse messages and take screenshot AFTER content has loaded
      const messages = await this.parseVisibleMessages();
      this.accumulateMessages(messages);
      await this.takeScreenshot();

      // 5. Check state after waiting
      const afterScroll = await this.getScrollState();

      const newContentLoaded =
        afterScroll.scrollHeight > beforeScroll.scrollHeight ||
        afterScroll.msgCount > beforeScroll.msgCount;

      if (afterScroll.scrollTop <= 1 && !newContentLoaded) {
        stuckCount = 1;
      } else {
        stuckCount = 0;
      }

      const reachedTop =
        (afterScroll.scrollTop <= 1 && stuckCount >= 1) ||
        afterScroll.isBeginning;

      console.log(
        `[capture] Step ${this.screenshotCount}: ${messages.length} visible, ${this.allMessages.length} total, scroll=${afterScroll.scrollTop}/${afterScroll.scrollHeight}, msgs=${afterScroll.msgCount}, newContent=${newContentLoaded}, stuck=${stuckCount}, top=${reachedTop}`
      );

      sendProgress({
        screenshotCount: this.screenshotCount,
        messageCount: this.allMessages.length,
        status: reachedTop
          ? "Reached the beginning of the chat!"
          : `Capturing... (${this.allMessages.length} messages, ${this.screenshotCount} screenshots)`,
      });

      if (reachedTop) {
        console.log("[capture] Reached top of chat");
        break;
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    // The capture loop will break on next iteration
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // ignore
      }
      this.browser = null;
      this.page = null;
    }
  }
}
