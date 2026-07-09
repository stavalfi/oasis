/**
 * create-finding.spec.ts
 *
 * The finding form: the real happy path (creates a Jira issue), client-side
 * validation (Create disabled until required fields are filled), the title
 * counter, and the server field-error rendering (field name in bold). All start
 * from the seeded session in global-setup.ts.
 *
 * Assumes the backend is running at http://localhost:3000 and the connected
 * account has a project with key `KAN` whose create screen needs only a title +
 * description. Change SIMPLE_PROJECT_KEY if yours differs.
 */
import { expect, selectProject, test } from "./fixtures.ts";

const SIMPLE_PROJECT_KEY = "KAN";

test("creates a finding and shows it in recent tickets", async ({ page, createdIssues }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "IdentityHub" })).toBeVisible();

  await selectProject({ page, projectKey: SIMPLE_PROJECT_KEY });

  const title = `E2E finding ${Date.now()}`;
  await page.locator("label", { hasText: "Title" }).locator("input").fill(title);
  await page
    .locator("label", { hasText: "Description" })
    .locator("textarea")
    .fill("Created by the Playwright e2e test.");
  await page.getByRole("button", { name: "Create ticket" }).click();

  const ticket = page.locator(".tickets__item", { hasText: title });
  await expect(ticket.locator(".tickets__title")).toBeVisible();
  await expect(page.locator(".banner--error")).toHaveCount(0);

  // Track the created issue so the fixture deletes it afterwards.
  createdIssues.push(((await ticket.locator(".tickets__key").textContent()) ?? "").trim());
});

test("keeps Create disabled until title and description are filled", async ({ page }) => {
  await page.goto("/");
  await selectProject({ page, projectKey: SIMPLE_PROJECT_KEY });

  const createButton = page.getByRole("button", { name: "Create ticket" });
  await expect(createButton).toBeDisabled();

  await page.locator("label", { hasText: "Title" }).locator("input").fill("Just a title");
  await expect(createButton).toBeDisabled();

  await page
    .locator("label", { hasText: "Description" })
    .locator("textarea")
    .fill("Now a description");
  await expect(createButton).toBeEnabled();
});

test("shows the live title character counter", async ({ page }) => {
  await page.goto("/");
  await selectProject({ page, projectKey: SIMPLE_PROJECT_KEY });

  await page.locator("label", { hasText: "Title" }).locator("input").fill("hello");
  await expect(page.locator(".field__counter")).toHaveText("5 / 255");
});

test("renders a server field error with the field name in bold", async ({ page }) => {
  // Force a Jira-style field validation error on submit.
  await page.route("**/api/tickets", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        body: JSON.stringify({
          message:
            "Budget Amount: Operation value must be a number\nOwner: Specify a valid value for Owner",
        }),
        contentType: "application/json",
        status: 400,
      });
    } else {
      await route.continue();
    }
  });

  await page.goto("/");
  await selectProject({ page, projectKey: SIMPLE_PROJECT_KEY });
  await page.locator("label", { hasText: "Title" }).locator("input").fill("Bold error test");
  await page
    .locator("label", { hasText: "Description" })
    .locator("textarea")
    .fill("Trigger a field error.");
  await page.getByRole("button", { name: "Create ticket" }).click();

  const banner = page.locator(".banner--error");
  await expect(banner.locator(".banner__line")).toHaveCount(2);
  // Each line's field name is bolded.
  await expect(banner.locator("strong")).toHaveText(["Budget Amount", "Owner"]);
  await expect(banner).toContainText("Operation value must be a number");
});

test("bolds the field name in a plain required-field error", async ({ page }) => {
  // The real message the backend sends for a missing field has no colon.
  await page.route("**/api/tickets", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        body: JSON.stringify({ message: "Description is required for this project." }),
        contentType: "application/json",
        status: 400,
      });
    } else {
      await route.continue();
    }
  });

  await page.goto("/");
  await selectProject({ page, projectKey: SIMPLE_PROJECT_KEY });
  await page.locator("label", { hasText: "Title" }).locator("input").fill("Required error test");
  await page
    .locator("label", { hasText: "Description" })
    .locator("textarea")
    .fill("Trigger a required error.");
  await page.getByRole("button", { name: "Create ticket" }).click();

  const banner = page.locator(".banner--error");
  await expect(banner).toContainText("is required for this project.");
  await expect(banner.locator("strong")).toHaveText("Description");
});
