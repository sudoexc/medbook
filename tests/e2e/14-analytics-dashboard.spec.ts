/**
 * Analytics — /crm/analytics renders and the aggregating API responds.
 * TZ §10.Фаза 7 scenario #14.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, crm, isAppHealthy } from "./helpers";

test.describe("analytics dashboard", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("/api/crm/analytics returns all 7 sections", async ({
    page,
    request,
  }) => {
    await as.admin(page);
    const res = await request.get(
      `${BASE_URL}/api/crm/analytics?period=week`,
      { failOnStatusCode: false },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    for (const k of [
      "revenueDaily",
      "appointmentsByStatus",
      "noShowDaily",
      "topDoctors",
      "topServices",
      "sources",
      "ltvBuckets",
    ]) {
      expect(body[k], `missing section: ${k}`).toBeDefined();
    }
  });

  test("/crm/analytics renders without crash", async ({ page }) => {
    await as.admin(page, { landing: crm("/analytics") });
    await expect(page).toHaveURL(/\/crm\/analytics/);
    const body = await page.content();
    // Basic smoke test — page shouldn't be an error overlay.
    expect(body).not.toContain("Application error");
  });
});
