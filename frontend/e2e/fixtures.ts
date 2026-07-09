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
import type { Page } from "@playwright/test";

const execFileAsync = promisify(execFile);

/**
 * Select a project in the react-select combobox by key. Typing the key filters
 * the options; Enter selects the highlighted match. (The project picker is a
 * react-select combobox, not a native `<select>`.)
 */
export const selectProject = async ({
  page,
  projectKey,
}: {
  page: Page;
  projectKey: string;
}): Promise<void> => {
  const project = page.getByRole("combobox", { name: "Project" });
  await project.click();
  await project.pressSequentially(projectKey);
  await project.press("Enter");
};

export const test = base.extend<{ createdIssues: string[] }>({
  // eslint-disable-next-line no-empty-pattern
  createdIssues: async ({}, use) => {
    const keys: string[] = [];
    await use(keys);
    if (keys.length > 0) {
      await execFileAsync("node", ["--env-file=.env", "frontend/e2e/delete-issues.ts", ...keys]);
    }
  },
});

export { expect } from "@playwright/test";
