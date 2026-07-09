/**
 * vite.config.ts
 *
 * Frontend bundler (runs on Node). It builds the React app into frontend/dist,
 * which the backend serves as static files on the same origin as the API. That
 * single origin is why the session cookie and OAuth callback work with no proxy
 * or CORS. `AppType` is imported type-only from the backend, so it is erased at
 * build time and never bundled.
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// oxlint-disable-next-line import/no-default-export
export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "../dist",
  },
  plugins: [react()],
  root: "frontend/src",
});
