import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

export interface AppSettings {
  outputDir: string;
}

const homeDir = process.env.USERPROFILE || process.env.HOME || ".";
const configDir = join(homeDir, "Documents", "Discapture");
const configPath = join(configDir, "config.json");

const defaults: AppSettings = {
  outputDir: join(homeDir, "Documents", "Discapture", "captures"),
};

export function loadSettings(): AppSettings {
  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    }
  } catch (err: any) {
    console.log(`[settings] Failed to load config: ${err.message}`);
  }
  return { ...defaults };
}

export function saveSettings(settings: AppSettings): void {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(settings, null, 2), "utf-8");
  console.log(`[settings] Saved config to ${configPath}`);
}
