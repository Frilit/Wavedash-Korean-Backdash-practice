import vinext from "vinext";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(({ command }) => ({
  resolve: {
    dedupe: ["react", "react-dom", "react-server-dom-webpack"],
  },
  server: isCodexSeatbeltSandbox
    ? { watch: { useFsEvents: false, usePolling: true } }
    : undefined,
  plugins: [vinext(), ...(command === "build" ? [nitro()] : [])],
}));
