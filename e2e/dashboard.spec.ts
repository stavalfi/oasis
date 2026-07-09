/**
 * dashboard.spec.ts
 *
 * The authenticated shell: header context (connected site + user), the shared
 * project picker, routing, and navigation to API keys. Starts from the seeded
 * session in global-setup.ts.
 */
import { expect, test } from "./fixtures.ts";

test("shows the connected Jira site and user in the header", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".header__site")).not.toBeEmpty();
  await expect(page.locator(".header__user")).toContainText("@");
});

test("explains that the project picker drives both cards", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".dashboard__picker-hint")).toContainText(
    "drives both the finding form and the recent tickets",
  );
});

test("redirects an unknown route to the dashboard", async ({ page }) => {
  await page.goto("/definitely-not-a-route");
  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(page.getByRole("heading", { name: "Report a finding" })).toBeVisible();
});

test("navigates to API keys and back to the dashboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "API keys" }).click();
  await expect(page.getByRole("heading", { name: "Create an API key" })).toBeVisible();

  await page.getByRole("link", { name: "IdentityHub" }).click();
  await expect(page.getByRole("heading", { name: "Report a finding" })).toBeVisible();
});
