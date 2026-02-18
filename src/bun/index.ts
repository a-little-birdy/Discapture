import {
  BrowserWindow,
  BrowserView,
  ApplicationMenu,
  type ElectrobunRPCSchema,
  type RPCSchema,
} from "electrobun/bun";
import { CaptureEngine } from "./capture-engine";
import { FileStorage } from "./file-storage";
import { loadSettings, saveSettings as persistSettings } from "./settings";

// --- RPC Schema ---

interface DiscaptureRPCSchema extends ElectrobunRPCSchema {
  bun: RPCSchema<{
    requests: {
      startCapture: {
        params: { format: string };
        response: { success: boolean; error?: string };
      };
      beginCapture: {
        params: undefined;
        response: { success: boolean; sessionId: string; error?: string };
      };
      stopCapture: {
        params: undefined;
        response: { success: boolean };
      };
      openFolder: {
        params: { path: string };
        response: { success: boolean };
      };
      getSettings: {
        params: undefined;
        response: { outputDir: string };
      };
      saveSettings: {
        params: { outputDir: string };
        response: { success: boolean };
      };
      browseFolder: {
        params: undefined;
        response: { path: string | null };
      };
      closeWindow: {
        params: undefined;
        response: { success: boolean };
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      captureProgress: {
        screenshotCount: number;
        messageCount: number;
        status: string;
      };
      captureReady: {};
      captureComplete: {
        sessionId: string;
        outputPath: string;
        messageCount: number;
        screenshotCount: number;
      };
      captureError: {
        message: string;
      };
    };
  }>;
}

// --- Initialize settings, storage and capture engine ---
const settings = loadSettings();
const storage = new FileStorage(settings.outputDir);
const engine = new CaptureEngine(storage);

// --- Create the main window ---
const win = new BrowserWindow({
  title: "Discapture - Discord Chat Capture",
  frame: { x: 100, y: 100, width: 800, height: 400 },
  url: "views://control-ui/index.html",
  titleBarStyle: "hidden",
  transparent: false,
  sandbox: false,
  rpc: BrowserView.defineRPC<DiscaptureRPCSchema>({
    maxRequestTime: 600000,
    handlers: {
      requests: {
        startCapture: async (params) => {
          console.log("[bun] startCapture:", params?.format);

          if (!params) {
            return { success: false, error: "No params" };
          }

          try {
            const result = await engine.setup(
              { format: params.format },
              (data) => win.webview.rpc?.send.captureProgress(data),
              (data) => win.webview.rpc?.send.captureComplete(data),
              (data) => win.webview.rpc?.send.captureError(data),
              () => win.webview.rpc?.send.captureReady({})
            );
            return result;
          } catch (err: any) {
            return {
              success: false,
              error: err.message || "Unknown error",
            };
          }
        },

        beginCapture: async () => {
          console.log("[bun] beginCapture");
          try {
            const result = await engine.beginCapture();
            return result;
          } catch (err: any) {
            return {
              success: false,
              sessionId: "",
              error: err.message || "Unknown error",
            };
          }
        },

        stopCapture: async () => {
          await engine.stop();
          return { success: true };
        },

        openFolder: async (params) => {
          if (!params?.path) return { success: false };
          try {
            Bun.spawn(["explorer.exe", params.path.replace(/\//g, "\\")]);
            return { success: true };
          } catch {
            return { success: false };
          }
        },

        getSettings: async () => {
          const current = loadSettings();
          return { outputDir: current.outputDir };
        },

        saveSettings: async (params) => {
          if (!params) return { success: false };
          persistSettings({ outputDir: params.outputDir });
          storage.setBaseDir(params.outputDir);
          return { success: true };
        },

        browseFolder: async () => {
          try {
            const ps = Bun.spawn([
              "powershell.exe",
              "-NoProfile",
              "-Command",
              `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select output directory'; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }`,
            ]);
            const text = await new Response(ps.stdout).text();
            const selected = text.trim();
            return { path: selected || null };
          } catch {
            return { path: null };
          }
        },

        closeWindow: async () => {
          win.close();
          return { success: true };
        },
      },
      messages: {},
    },
  }),
});

// --- Application Menu (empty — frameless window uses custom title bar) ---
ApplicationMenu.setApplicationMenu([]);

console.log("[bun] Discapture app started");
