import { defineConfig } from "vite";
export default defineConfig({
  // Prebundle worker dependencies up front so first validation cannot trigger a full page reload.
  optimizeDeps: {
    include: ["papaparse", "@noble/hashes/sha2.js", "@noble/hashes/utils.js"],
  },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
