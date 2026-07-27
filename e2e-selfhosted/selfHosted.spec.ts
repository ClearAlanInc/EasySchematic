import { test, expect } from "@playwright/test";

/**
 * Self-hosted / fully-offline build (VITE_SELF_HOSTED=true, via the selfhosted
 * Vite mode): the app must make ZERO requests to any origin other than the dev
 * server, and all cloud/community UI must be hidden.
 *
 * The request log is the enforcement mechanism: every request the page makes is
 * recorded, including the App online-effect's 3s poll window, the device library
 * mount, and a tab blur/refocus cycle (which triggers the visibilitychange
 * session re-check in a hosted build).
 */

const DEV_ORIGIN = "http://localhost:5183";

test("makes zero external requests and hides cloud UI", async ({ page }) => {
  const requested: string[] = [];
  await page.route("**/*", (route) => {
    requested.push(route.request().url());
    void route.continue();
  });

  await page.addInitScript(() => localStorage.setItem("easyschematic-skip-landing", "1"));
  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });

  // Device library must be populated from the bundled fallback — and with no
  // "couldn't load the full device library" degraded banner (it should never
  // appear in a build that intentionally doesn't fetch).
  await expect(page.getByText(/couldn't load the full device library/i)).toHaveCount(0);

  // Trigger the visibilitychange path (hosted builds re-run checkSession here).
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });

  // Sit past the 3-second navigator.onLine poll window of the hosted build.
  await page.waitForTimeout(4_000);

  // No login button, no user menu — cloud UI is hidden, not just disabled.
  await expect(page.getByRole("button", { name: /^log in$/i })).toHaveCount(0);

  // File menu carries no cloud items.
  await page.getByRole("button", { name: "File" }).click();
  await expect(page.getByText("Save to Cloud")).toHaveCount(0);
  await expect(page.getByText("My Schematics...")).toHaveCount(0);
  await expect(page.getByText("Save As...")).toBeVisible(); // menu did open
  await page.keyboard.press("Escape");

  // THE core assertion: every single request stayed on the dev server origin.
  const external = requested.filter((u) => !u.startsWith(DEV_ORIGIN));
  expect(external, `External requests detected:\n${external.join("\n")}`).toEqual([]);
});

test("device library is populated from the bundled fallback", async ({ page }) => {
  const requested: string[] = [];
  await page.route("**/*", (route) => {
    requested.push(route.request().url());
    void route.continue();
  });

  await page.addInitScript(() => localStorage.setItem("easyschematic-skip-landing", "1"));
  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible({ timeout: 30_000 });

  // The library search box exists and a well-known bundled template can be found.
  const search = page.getByPlaceholder(/search/i).first();
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill("ATEM");
  await expect(page.getByText(/ATEM/i).first()).toBeVisible({ timeout: 10_000 });

  const external = requested.filter((u) => !u.startsWith(DEV_ORIGIN));
  expect(external, `External requests detected:\n${external.join("\n")}`).toEqual([]);
});
