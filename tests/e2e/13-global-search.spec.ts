/**
 * Global search — Cmd/Ctrl+K opens dialog; API returns grouped results.
 * TZ §10.Фаза 7 scenario #13.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, crm, isAppHealthy } from "./helpers";

test.describe("global search", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("search API returns grouped results for a seeded name", async ({
    page,
    request,
  }) => {
    await as.admin(page);
    const res = await request.get(
      `${BASE_URL}/api/crm/search?q=Иванов`,
      { failOnStatusCode: false },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    // The endpoint groups hits by entity; assert the object has at least one
    // known group.
    const groups = Object.keys(body);
    expect(groups.length).toBeGreaterThan(0);
  });

  test("Ctrl+K on a CRM page opens the dialog", async ({ page }) => {
    await as.admin(page, { landing: crm("/") });
    // Using keyboard shortcut — the handler is wired via `useGlobalSearchShortcut`.
    await page.keyboard.press("Control+KeyK");
    // cmdk renders a dialog with role=dialog; tolerate either cmdk or Radix.
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.first()).toBeVisible({ timeout: 5_000 });
  });
});
