/**
 * api-key-machine.spec.ts
 *
 * The machine REST path: mint an API key in the UI, then use it (as a Bearer
 * token, via plain fetch) to create 20 findings concurrently against the real
 * machine endpoint. Every created issue is tracked so the fixture deletes them
 * afterwards.
 */
import { expect, test } from "./fixtures.ts";

const APP_URL = "http://localhost:3000";
const SIMPLE_PROJECT_KEY = "KAN";
const CONCURRENT_CREATES = 20;

test("mints an API key and creates 20 findings concurrently via the machine API", async ({
  page,
  createdIssues,
}) => {
  // Mint a key in the UI and grab the raw value (shown once).
  await page.goto("/settings/api-keys");
  await page.getByPlaceholder("e.g. prod-scanner").fill(`machine-${Date.now()}`);
  await page.getByRole("button", { name: "Create key" }).click();
  const rawKey = await page.locator(".create-key__value").textContent();
  const apiKey = (rawKey ?? "").trim();
  expect(apiKey).toMatch(/^ih_/u);

  // Fire 20 concurrent creates against the machine endpoint with the key.
  const stamp = Date.now();
  const responses = await Promise.all(
    Array.from({ length: CONCURRENT_CREATES }, (_unused, index) =>
      // Direct fetch is banned repo-wide, but here we intentionally exercise the
      // machine API exactly as an external caller would (Bearer API key).
      // oxlint-disable-next-line no-restricted-globals
      fetch(`${APP_URL}/api/v1/findings`, {
        body: JSON.stringify({
          description: "Created concurrently by the machine e2e test.",
          projectKey: SIMPLE_PROJECT_KEY,
          title: `E2E machine ${stamp}-${index}`,
        }),
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        method: "POST",
      }),
    ),
  );

  // All succeed and return a new issue key; track each for cleanup.
  const bodies: { key: string }[] = await Promise.all(responses.map((response) => response.json()));
  for (const [index, response] of responses.entries()) {
    expect(response.status, `create #${index} should be 201`).toBe(201);
    createdIssues.push(bodies[index]?.key ?? "");
  }
  expect(createdIssues.filter((key) => key.length > 0)).toHaveLength(CONCURRENT_CREATES);
});
