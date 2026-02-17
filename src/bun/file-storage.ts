import { join } from "path";
import { mkdirSync, existsSync } from "fs";

export interface CaptureSession {
  id: string;
  outputDir: string;
  format: "json" | "csv";
  startTime: Date;
}

export class FileStorage {
  private baseDir: string;

  constructor() {
    const homeDir = process.env.USERPROFILE || process.env.HOME || ".";
    this.baseDir = join(homeDir, "Documents", "Dispatch", "captures");
  }

  createSession(format: string): CaptureSession {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const id = `capture-${timestamp}`;
    const outputDir = join(this.baseDir, id);
    const screenshotsDir = join(outputDir, "screenshots");
    const attachmentsDir = join(outputDir, "attachments");

    // Ensure directories exist
    if (!existsSync(screenshotsDir)) {
      mkdirSync(screenshotsDir, { recursive: true });
    }
    if (!existsSync(attachmentsDir)) {
      mkdirSync(attachmentsDir, { recursive: true });
    }

    return {
      id,
      outputDir,
      format: format as "json" | "csv",
      startTime: new Date(),
    };
  }

  async saveScreenshot(
    session: CaptureSession,
    index: number,
    base64Data: string
  ): Promise<string> {
    // Strip the data URL prefix if present
    const raw = base64Data.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(raw, "base64");
    const filename = `screenshot-${String(index).padStart(4, "0")}.png`;
    const filePath = join(session.outputDir, "screenshots", filename);
    await Bun.write(filePath, buffer);
    return filePath;
  }

  async downloadAttachments(
    session: CaptureSession,
    urls: string[],
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<Map<string, string>> {
    const attachmentsDir = join(session.outputDir, "attachments");
    let downloaded = 0;
    const seenFilenames = new Set<string>();
    const urlToFile = new Map<string, string>();

    for (const url of urls) {
      try {
        // Extract filename from URL, strip query params
        let filename = decodeURIComponent(
          url.split("/").pop()?.split("?")[0] || "unknown"
        );

        // Deduplicate filenames
        if (seenFilenames.has(filename)) {
          const ext = filename.includes(".") ? "." + filename.split(".").pop() : "";
          const base = filename.replace(ext, "");
          let i = 2;
          while (seenFilenames.has(`${base}-${i}${ext}`)) i++;
          filename = `${base}-${i}${ext}`;
        }
        seenFilenames.add(filename);

        const res = await fetch(url);
        if (!res.ok) continue;

        const buffer = await res.arrayBuffer();
        await Bun.write(join(attachmentsDir, filename), buffer);
        urlToFile.set(url, `attachments/${filename}`);
        downloaded++;
        onProgress?.(downloaded, urls.length);
      } catch (err: any) {
        console.log(`[capture] Failed to download attachment: ${url} - ${err.message}`);
      }
    }

    return urlToFile;
  }

  async saveLog(
    session: CaptureSession,
    messages: Array<{
      id: string;
      author: string;
      timestamp: string;
      content: string;
      attachments: { url: string; localFile?: string }[];
      embeds: string[];
    }>
  ): Promise<string> {
    if (session.format === "json") {
      const logPath = join(session.outputDir, "messages.json");
      const jsonContent = JSON.stringify(
        {
          capturedAt: session.startTime.toISOString(),
          messageCount: messages.length,
          messages: messages,
        },
        null,
        2
      );
      await Bun.write(logPath, jsonContent);
      return logPath;
    } else {
      const logPath = join(session.outputDir, "messages.csv");
      const escapeCsv = (s: string) =>
        `"${s.replace(/"/g, '""').replace(/\n/g, "\\n")}"`;
      const header = "id,author,timestamp,content,attachments,embeds\n";
      const rows = messages
        .map((m) =>
          [
            escapeCsv(m.id),
            escapeCsv(m.author),
            escapeCsv(m.timestamp),
            escapeCsv(m.content),
            escapeCsv(m.attachments.map((a) => a.localFile || a.url).join("; ")),
            escapeCsv(m.embeds.join("; ")),
          ].join(",")
        )
        .join("\n");
      await Bun.write(logPath, header + rows);
      return logPath;
    }
  }
}
