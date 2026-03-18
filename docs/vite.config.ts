import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import appShimPlugin from "./vite-alias-plugin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use temp dir for cache to avoid file-locking issues
const cacheDir = path.join(os.tmpdir(), "vite-easyschematic-docs");

export default defineConfig({
  cacheDir,
  plugins: [react(), appShimPlugin()],
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "zustand",
      "@xyflow/react",
      "@xyflow/system",
    ],
  },
  define: {
    __APP_VERSION__: JSON.stringify("docs"),
    __BUILD_HASH__: JSON.stringify("docs"),
  },
});
