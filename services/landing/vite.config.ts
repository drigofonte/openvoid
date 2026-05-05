import { defineConfig } from "vitest/config";

// VITE_OPENVOID_API_URL is the only build-arg the Dockerfile threads
// through. kind bakes http://api.127.0.0.1.nip.io; DOKS bakes
// https://api.<domain>. The value lands as `import.meta.env.VITE_*`
// in src/api.ts.
export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
  test: {
    environment: "happy-dom",
  },
});
