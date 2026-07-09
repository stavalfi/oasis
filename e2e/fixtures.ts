/**
 * fixtures.ts
 *
 * Extends the Playwright test with a `createdIssues` collector. A test pushes
 * every Jira issue key it creates; after the test, the fixture teardown deletes
 * them from Jira (via delete-issues.ts) so runs don't accumulate real issues.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test as base } from "@playwright/test";

const execFileAsync = promisify(execFile);

export const test = base.extend<{ createdIssues: string[] }>({
  // eslint-disable-next-line no-empty-pattern
  createdIssues: async ({}, use) => {
    const keys: string[] = [];
    await use(keys);
    if (keys.length > 0) {
      await execFileAsync("node", ["--env-file=.env", "e2e/delete-issues.ts", ...keys]);
    }
  },
});

export { expect } from "@playwright/test";
