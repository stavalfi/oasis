/**
 * playwright.config.ts
 *
 * Local-only end-to-end config. The backend (which also serves the UI) must be
 * running at http://localhost:3000 before `bun run e2e`, so there is no
 * `webServer` here. `globalSetup` seeds a session for the already-connected Jira
 * user (real OAuth can't be scripted), and every test starts from that session
 * via `storageState`.
 *
 * On NixOS the Chromium that Playwright downloads can't run (dynamic linker), so
 * we point it at the system Chromium on PATH (provided by the dev shell).
 */
// The Playwright config is evaluated synchronously, so resolving the system
// Chromium path here must be sync too (no event loop to block).
// oxlint-disable-next-line no-restricted-imports
import { execFileSync } from "node:child_process";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const chromiumExecutable = execFileSync("sh", ["-c", "command -v chromium"], {
  encoding: "utf8",
}).trim();

// oxlint-disable-next-line import/no-default-export
export default defineConfig({
  expect: { timeout: 30_000 },
  fullyParallel: false,
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium", launchOptions: { executablePath: chromiumExecutable } },
    },
  ],
  reporter: "list",
  retries: 0,
  testDir: "e2e",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3000",
    storageState: path.join(import.meta.dirname, "e2e", ".auth", "state.json"),
  },
  workers: 1,
});
