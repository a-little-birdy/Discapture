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

    // Ensure directories exist
    if (!existsSync(screenshotsDir)) {
      mkdirSync(screenshotsDir, { recursive: true });
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

  async saveLog(
    session: CaptureSession,
    messages: Array<{
      id: string;
      author: string;
      timestamp: string;
      content: string;
      attachments: string[];
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
            escapeCsv(m.attachments.join("; ")),
            escapeCsv(m.embeds.join("; ")),
          ].join(",")
        )
        .join("\n");
      await Bun.write(logPath, header + rows);
      return logPath;
    }
  }
}
