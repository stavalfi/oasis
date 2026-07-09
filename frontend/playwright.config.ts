/**
 * playwright.config.ts
 *
 * Local-only end-to-end config. The backend (which also serves the UI) must be
 * running at http://localhost:3000 before `npm run e2e`, so there is no
 * `webServer` here. `globalSetup` seeds a session for the already-connected Jira
 * user (real OAuth can't be scripted), and every test starts from that session
 * via `storageState`.
 *
 * On NixOS the Chromium that Playwright downloads can't run (dynamic linker), so
 * we point it at the system Chromium on PATH (provided by the dev shell).
 */
// oxlint-disable-next-line no-restricted-imports
import { defineConfig } from "@playwright/test";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// This module is ESM, so resolving the system Chromium path uses top-level await.
const { stdout } = await execFileAsync("sh", ["-c", "command -v chromium"]);
const chromiumExecutable = stdout.trim();

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
