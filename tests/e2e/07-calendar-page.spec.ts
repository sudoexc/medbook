/**
 * Calendar — page renders week view without errors.
 * TZ §10.Фаза 7 scenario #7 — DnD reschedule is covered by #6 at the API
 * layer; here we validate the /crm/calendar page mounts FullCalendar.
 */
import { test, expect } from "@playwright/test";

import { HAS_TEST_DB, as, crm, isAppHealthy } from "./helpers";

test.describe("calendar — renders", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("/crm/calendar mounts without crashing", async ({ page }) => {
    await as.admin(page, { landing: crm("/calendar") });
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveURL(/\/crm\/calendar/);
    // FullCalendar injects a class "fc" on the calendar root.
    const fc = page.locator(".fc");
    // Allow up to 15s for dynamic imports.
    await expect(fc).toBeVisible({ timeout: 15_000 });
  });
});
