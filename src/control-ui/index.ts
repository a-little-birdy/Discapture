import {
  Electroview,
  type ElectrobunRPCSchema,
  type RPCSchema,
} from "electrobun/view";

// --- RPC Schema (must match bun side) ---

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

// --- DOM references ---
const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnOpenFolder = document.getElementById(
  "btn-open-folder"
) as HTMLButtonElement;
const outputFormat = document.getElementById(
  "output-format"
) as HTMLSelectElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const msgCount = document.getElementById("msg-count") as HTMLSpanElement;
const ssCount = document.getElementById("ss-count") as HTMLSpanElement;
const controlBar = document.getElementById("control-bar") as HTMLElement;

let lastOutputPath = "";

// --- Initialize Electroview with RPC ---

const electrobun = new Electroview({
  rpc: Electroview.defineRPC<DispatchRPCSchema>({
    maxRequestTime: 600000,
    handlers: {
      requests: {},
      messages: {
        captureProgress: (data) => {
          statusText.textContent = data.status;
          msgCount.textContent = `Messages: ${data.messageCount}`;
          ssCount.textContent = `Screenshots: ${data.screenshotCount}`;
        },
        captureComplete: (data) => {
          statusText.textContent = `Capture complete! ${data.messageCount} messages, ${data.screenshotCount} screenshots.`;
          lastOutputPath = data.outputPath;
          btnStart.disabled = false;
          btnStop.disabled = true;
          btnOpenFolder.style.display = "inline-block";
          controlBar.classList.remove("capturing");
        },
        captureError: (data) => {
          statusText.textContent = `Error: ${data.message}`;
          btnStart.disabled = false;
          btnStop.disabled = true;
          controlBar.classList.remove("capturing");
        },
      },
    },
  }),
});

// --- Button handlers ---

btnStart.addEventListener("click", async () => {
  const format = outputFormat.value;

  btnStart.disabled = true;
  btnStop.disabled = false;
  btnOpenFolder.style.display = "none";
  controlBar.classList.add("capturing");
  statusText.textContent = "Starting capture...";
  msgCount.textContent = "Messages: 0";
  ssCount.textContent = "Screenshots: 0";

  // Bun finds the Discord webview itself - no webviewId needed from the browser
  const result = await electrobun.rpc?.request.startCapture({ format });

  if (result && !result.success) {
    statusText.textContent = `Failed: ${result.error || "Unknown error"}`;
    btnStart.disabled = false;
    btnStop.disabled = true;
    controlBar.classList.remove("capturing");
  }
});

btnStop.addEventListener("click", async () => {
  statusText.textContent = "Stopping capture...";
  await electrobun.rpc?.request.stopCapture();
  btnStop.disabled = true;
  btnStart.disabled = false;
  controlBar.classList.remove("capturing");
  statusText.textContent = "Capture stopped by user.";
});

btnOpenFolder.addEventListener("click", () => {
  if (lastOutputPath) {
    statusText.textContent = `Output saved to: ${lastOutputPath}`;
  }
});
