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

// --- Phase management ---

const phases = ["idle", "connecting", "ready", "recording", "done"] as const;

function showPhase(id: typeof phases[number]) {
  for (const p of phases) {
    const el = document.getElementById(`phase-${p}`);
    if (el) el.classList.toggle("hidden", p !== id);
  }
}

// --- DOM references ---

const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnRecord = document.getElementById("btn-record") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnAgain = document.getElementById("btn-again") as HTMLButtonElement;
const outputFormat = document.getElementById("output-format") as HTMLSelectElement;
const connectingStatus = document.getElementById("connecting-status") as HTMLParagraphElement;
const recordingStatus = document.getElementById("recording-status") as HTMLParagraphElement;
const msgCount = document.getElementById("msg-count") as HTMLSpanElement;
const ssCount = document.getElementById("ss-count") as HTMLSpanElement;
const doneMsgs = document.getElementById("done-msgs") as HTMLElement;
const doneSs = document.getElementById("done-ss") as HTMLElement;
const donePath = document.getElementById("done-path") as HTMLParagraphElement;
const btnOpenFolder = document.getElementById("btn-open-folder") as HTMLButtonElement;

// --- Initialize Electroview with RPC ---

const electrobun = new Electroview({
  rpc: Electroview.defineRPC<DispatchRPCSchema>({
    maxRequestTime: 600000,
    handlers: {
      requests: {},
      messages: {
        captureProgress: (data) => {
          msgCount.textContent = String(data.messageCount);
          ssCount.textContent = String(data.screenshotCount);
          // Update connecting phase status if still connecting
          connectingStatus.textContent = data.status;
          recordingStatus.textContent = data.status;
        },
        captureReady: () => {
          showPhase("ready");
        },
        captureComplete: (data) => {
          doneMsgs.textContent = String(data.messageCount);
          doneSs.textContent = String(data.screenshotCount);
          donePath.textContent = data.outputPath;
          showPhase("done");
        },
        captureError: (data) => {
          // Show ready phase so they can try again
          showPhase("ready");
          const readyStatus = document.querySelector("#phase-ready .status-msg") as HTMLElement;
          if (readyStatus) readyStatus.textContent = `Error: ${data.message}`;
        },
      },
    },
  }),
});

// --- Button handlers ---

btnStart.addEventListener("click", async () => {
  const format = outputFormat.value;
  showPhase("connecting");
  connectingStatus.textContent = "Launching browser...";

  const result = await electrobun.rpc?.request.startCapture({ format });

  if (result && result.success) {
    showPhase("ready");
  } else {
    showPhase("idle");
  }
});

btnRecord.addEventListener("click", async () => {
  showPhase("recording");
  msgCount.textContent = "0";
  ssCount.textContent = "0";
  recordingStatus.textContent = "Capturing...";

  const result = await electrobun.rpc?.request.beginCapture();

  if (result && !result.success) {
    showPhase("ready");
  }
});

btnStop.addEventListener("click", async () => {
  recordingStatus.textContent = "Stopping...";
  await electrobun.rpc?.request.stopCapture();
  showPhase("ready");
});

btnAgain.addEventListener("click", () => {
  showPhase("ready");
  msgCount.textContent = "0";
  ssCount.textContent = "0";
});

btnOpenFolder.addEventListener("click", async () => {
  const path = donePath.textContent;
  if (path) {
    await electrobun.rpc?.request.openFolder({ path });
  }
});
