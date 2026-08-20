/**
 * Analytics — Phase 8a conversion-funnel KPIs.
 *
 * The funnels feature sits behind `hasAnalyticsPro`, which the current plan
 * matrix grants to the `enterprise` plan only (the seeded clinic runs `pro`,
 * where funnels correctly answer 404 — that gating is covered by
 * 25-feature-flags-gating.spec.ts). So this spec temporarily upgrades the
 * seeded NeuroFax clinic to `enterprise` via the SUPER_ADMIN billing API,
 * verifies the API + UI, and restores `pro` in a finally block.
 *
 * Verifies:
 *   1. `/api/crm/analytics/funnels` returns the KPI sections.
 *   2. `/crm/analytics` renders funnel cards once data resolves, and they
 *      survive a period switch.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, crm, isAppHealthy } from "./helpers";

test.describe("analytics — conversion funnel KPIs", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("funnels API + UI under an analytics-pro plan", async ({ browser }) => {
    // ── SUPER_ADMIN context to manipulate the subscription. ───────────────
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await as.superAdmin(adminPage);

    const clinicsRes = await adminCtx.request.get(
      `${BASE_URL}/api/platform/clinics`,
      { failOnStatusCode: false },
    );
    expect(clinicsRes.ok()).toBeTruthy();
    const clinicsBody = (await clinicsRes.json()) as {
      clinics?: Array<{ id: string; slug: string }>;
    };
    const target = (clinicsBody.clinics ?? []).find(
      (c) => c.slug === "neurofax",
    );
    test.skip(!target, "seed missing `neurofax` clinic");
    const clinicId = target!.id;

    const plansRes = await adminCtx.request.get(`${BASE_URL}/api/admin/plans`, {
      failOnStatusCode: false,
    });
    expect(plansRes.ok()).toBeTruthy();
    const plansBody = (await plansRes.json()) as {
      plans?: Array<{ id: string; slug: string }>;
    };
    const enterprise = (plansBody.plans ?? []).find(
      (p) => p.slug === "enterprise",
    );
    const pro = (plansBody.plans ?? []).find((p) => p.slug === "pro");
    test.skip(!enterprise || !pro, "enterprise/pro plans missing in catalog");

    const tenantCtx = await browser.newContext();
    const tenantPage = await tenantCtx.newPage();

    try {
      // ── Upgrade to enterprise (hasAnalyticsPro=true). ───────────────────
      const upgrade = await adminCtx.request.patch(
        `${BASE_URL}/api/admin/clinics/${clinicId}/subscription`,
        {
          data: { planId: enterprise!.id },
          failOnStatusCode: false,
        },
      );
      expect(upgrade.ok()).toBeTruthy();

      // ── 1. API returns the KPI sections. ────────────────────────────────
      await as.admin(tenantPage, { request: tenantCtx.request });
      const res = await tenantCtx.request.get(
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
      const tg = body.tg as Record<string, unknown>;
      expect(tg.daily).toBeDefined();
      expect(typeof tg.rate).toBe("number");

      // ── 2. UI renders funnel cards; period switch keeps them alive. ─────
      await tenantPage.goto(`${BASE_URL}${crm("/analytics")}`);
      await expect(tenantPage).toHaveURL(/\/crm\/analytics/);

      const cards = tenantPage.getByTestId("analytics-funnel-card");
      // The redesigned bottom row renders 3 funnel cards (tg / call / no-show).
      await expect(cards.first()).toBeVisible({ timeout: 20_000 });
      expect(await cards.count()).toBeGreaterThanOrEqual(3);

      const monthButton = tenantPage
        .getByRole("button", { name: /^(Месяц|Oy)$/ })
        .first();
      if (await monthButton.isVisible().catch(() => false)) {
        await monthButton.click();
      }
      await expect(cards.first()).toBeVisible({ timeout: 20_000 });
    } finally {
      // ── Restore the seeded `pro` plan for downstream specs. ─────────────
      await adminCtx.request.patch(
        `${BASE_URL}/api/admin/clinics/${clinicId}/subscription`,
        {
          data: { planId: pro!.id },
          failOnStatusCode: false,
        },
      );
      await adminCtx.close();
      await tenantCtx.close();
    }
  });
});
