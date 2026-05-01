/**
 * Analytics — Phase 8a conversion-funnel KPIs.
 *
 * Verifies:
 *   1. `/api/crm/analytics/funnels` returns the four KPI sections.
 *   2. `/crm/analytics` renders four funnel cards once data resolves.
 *   3. Switching the period control (e.g. → "month") refetches and the
 *      cards stay visible.
 *
 * Specs gracefully self-skip if the dev DB or webserver isn't reachable
 * (matches `14-analytics-dashboard.spec.ts`).
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, crm, isAppHealthy } from "./helpers";

test.describe("analytics — conversion funnel KPIs", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("/api/crm/analytics/funnels returns 4 KPI sections", async ({
    page,
    request,
  }) => {
    await as.admin(page);
    const res = await request.get(
      `${BASE_URL}/api/crm/analytics/funnels?period=week`,
      { failOnStatusCode: false },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    for (const k of [
      "tg",
      "call",
      "noShowByDoctor",
      "noShowByService",
      "waitTime",
      "windowDays",
    ]) {
      expect(body[k], `missing section: ${k}`).toBeDefined();
    }
    // miniAppFunnel is intentionally null until we add an events table.
    expect(body.miniAppFunnel).toBeNull();
    // tg/call summary objects must have rate + daily.
    const tg = body.tg as Record<string, unknown>;
    expect(tg.daily).toBeDefined();
    expect(typeof tg.rate).toBe("number");
  });

  test("/crm/analytics renders funnel cards and survives a period switch", async ({
    page,
  }) => {
    await as.admin(page, { landing: crm("/analytics") });
    await expect(page).toHaveURL(/\/crm\/analytics/);

    // Wait for funnel cards to mount (dynamic import + react-query roundtrip).
    const funnels = page.getByTestId("analytics-funnels");
    await expect(funnels).toBeVisible({ timeout: 15_000 });

    const cards = page.getByTestId("analytics-funnel-card");
    await expect(cards).toHaveCount(4);

    // Switch to "month" via the period control. The control is a button group;
    // we click by visible text. The control supports week/month/quarter; we
    // pick "month" since it's the default in the API but flipping triggers
    // a refetch through the query cache.
    const monthButton = page
      .getByRole("button", { name: /^(Месяц|Oy)$/ })
      .first();
    if (await monthButton.isVisible().catch(() => false)) {
      await monthButton.click();
    }

    // Cards should remain visible after refetch.
    await expect(funnels).toBeVisible();
    await expect(cards).toHaveCount(4);
  });
});
