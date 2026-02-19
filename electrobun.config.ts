import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Discapture",
    identifier: "dev.discapture.app",
    version: "0.1.0",
    description: "Discord chat capture and archival tool",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      "control-ui": {
        entrypoint: "src/control-ui/index.ts",
      },
    },
    copy: {
      "src/control-ui/index.html": "views/control-ui/index.html",
      "src/control-ui/style.css": "views/control-ui/style.css",
    },
    win: {
      icon: "src/assets/logo.png",
    },
    linux: {
      icon: "src/assets/logo.png",
    },
  },
} satisfies ElectrobunConfig;
