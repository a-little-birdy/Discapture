import {
  BrowserWindow,
  BrowserView,
  ApplicationMenu,
  type ElectrobunRPCSchema,
  type RPCSchema,
} from "electrobun/bun";
import { CaptureEngine } from "./capture-engine";
import { FileStorage } from "./file-storage";

// --- RPC Schema ---

interface DispatchRPCSchema extends ElectrobunRPCSchema {
  bun: RPCSchema<{
    requests: {
      startCapture: {
        params: { format: string };
        response: { success: boolean; sessionId: string; error?: string };
      };
      stopCapture: {
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

// --- Initialize storage and capture engine ---
const storage = new FileStorage();
const engine = new CaptureEngine(storage);

// --- Create the main window ---
const win = new BrowserWindow({
  title: "Dispatch - Discord Chat Capture",
  frame: { x: 100, y: 100, width: 800, height: 400 },
  url: "views://control-ui/index.html",
  titleBarStyle: "default",
  transparent: false,
  sandbox: false,
  rpc: BrowserView.defineRPC<DispatchRPCSchema>({
    maxRequestTime: 600000,
    handlers: {
      requests: {
        startCapture: async (params) => {
          console.log("[bun] startCapture:", params?.format);

          if (!params) {
            return { success: false, sessionId: "", error: "No params" };
          }

          try {
            const result = await engine.start(
              { format: params.format },
              (data) => win.webview.rpc?.send.captureProgress(data),
              (data) => win.webview.rpc?.send.captureComplete(data),
              (data) => win.webview.rpc?.send.captureError(data)
            );
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
      },
      messages: {},
    },
  }),
});

// --- Application Menu ---
ApplicationMenu.setApplicationMenu([
  {
    submenu: [{ label: "Quit Dispatch", role: "quit" }],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  {
    label: "View",
    submenu: [{ role: "reload" }],
  },
]);

console.log("[bun] Dispatch app started");
