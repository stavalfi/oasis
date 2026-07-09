/**
 * api-keys.spec.ts
 *
 * The API keys page: create a key with a chosen expiry (shown once), see it in
 * the list, and revoke it. Starts from the seeded session in global-setup.ts.
 */
import { expect, test } from "./fixtures.ts";

test("creates a key with a chosen expiry, shows it once, then revokes it", async ({ page }) => {
  await page.goto("/settings/api-keys");
  await expect(page.getByRole("heading", { name: "Create an API key" })).toBeVisible();

  const name = `e2e-key-${Date.now()}`;
  await page.getByPlaceholder("e.g. prod-scanner").fill(name);
  // Pick the "1 day" preset (option value is the number of days).
  await page.locator("label", { hasText: "Expires in" }).locator("select").selectOption("1");
  await page.getByRole("button", { name: "Create key" }).click();

  // The raw key is shown exactly once.
  await expect(page.locator(".banner--success")).toContainText("Copy your key");
  await expect(page.locator(".create-key__value")).toContainText("ih_");

  // It appears in the list.
  const row = page.locator("tr", { hasText: name });
  await expect(row).toBeVisible();

  // Revoke it (accept the confirm dialog) and confirm it's gone.
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(page.locator("tr", { hasText: name })).toHaveCount(0);
});
