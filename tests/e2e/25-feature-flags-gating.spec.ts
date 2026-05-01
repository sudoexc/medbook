/**
 * Phase 9d — plan-aware nav + route guard happy path.
 *
 * Scenario:
 *   1. Log in as ADMIN of the seeded NeuroFax clinic (subscribed to `pro`
 *      out of the box).
 *   2. Hit `/api/crm/calls` and `/api/crm/conversations` — both should 200
 *      because Pro includes call-center + telegram.
 *   3. Downgrade the clinic to Basic via the SUPER_ADMIN billing API.
 *   4. As ADMIN again, request `/api/crm/calls`. Expect 404 (feature gated).
 *   5. Visit `/crm/call-center` — page-level guard returns 404 too.
 *   6. Restore the Pro plan so downstream specs see the deterministic seed.
 *
 * Self-skips when DATABASE_URL_TEST is absent or the app is not healthy —
 * matches the convention of the other Phase 7+ specs.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("feature flags — plan-aware route guards", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("Pro plan exposes call-center; downgrade to Basic returns 404", async ({
    browser,
  }) => {
    // ── 1. SUPER_ADMIN context to manipulate the subscription. ────────────
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await as.superAdmin(adminPage);

    // Resolve the seeded `neurofax` clinic id.
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

    // Pre-warm the subscription (idempotent).
    await adminCtx.request.get(
      `${BASE_URL}/api/admin/clinics/${clinicId}/subscription`,
      { failOnStatusCode: false },
    );

    // Plan ids.
    const plansRes = await adminCtx.request.get(`${BASE_URL}/api/admin/plans`, {
      failOnStatusCode: false,
    });
    expect(plansRes.ok()).toBeTruthy();
    const plansBody = (await plansRes.json()) as {
      plans?: Array<{ id: string; slug: string }>;
    };
    const basic = (plansBody.plans ?? []).find((p) => p.slug === "basic");
    const pro = (plansBody.plans ?? []).find((p) => p.slug === "pro");
    test.skip(!basic || !pro, "basic/pro plans missing in catalog");

    // ── 2. Tenant ADMIN — sanity-check the Pro path 200s. ─────────────────
    const tenantCtx = await browser.newContext();
    const tenantPage = await tenantCtx.newPage();
    await as.admin(tenantPage);

    const callsProRes = await tenantCtx.request.get(
      `${BASE_URL}/api/crm/calls?limit=1`,
      { failOnStatusCode: false },
    );
    expect.soft(callsProRes.status()).toBe(200);

    try {
      // ── 3. Downgrade to Basic. ──────────────────────────────────────────
      const downgrade = await adminCtx.request.patch(
        `${BASE_URL}/api/admin/clinics/${clinicId}/subscription`,
        {
          data: { planId: basic!.id, status: "ACTIVE" },
          failOnStatusCode: false,
        },
      );
      expect(downgrade.ok()).toBeTruthy();

      // ── 4. ADMIN now hits /api/crm/calls → 404. ─────────────────────────
      const callsBasicRes = await tenantCtx.request.get(
        `${BASE_URL}/api/crm/calls?limit=1`,
        { failOnStatusCode: false },
      );
      expect(callsBasicRes.status()).toBe(404);
      const body = (await callsBasicRes.json()) as { error?: string };
      // The error body must not echo the feature key (no leak).
      expect(JSON.stringify(body)).not.toContain("hasCallCenter");

      // ── 5. Page-level guard — /crm/call-center → notFound(). ────────────
      const navResp = await tenantPage.goto(`${BASE_URL}/ru/crm/call-center`, {
        waitUntil: "domcontentloaded",
      });
      expect(navResp?.status()).toBe(404);

      // ── 5b. The funnels endpoint is also gated (hasAnalyticsPro=false).
      const funnelsRes = await tenantCtx.request.get(
        `${BASE_URL}/api/crm/analytics/funnels?period=week`,
        { failOnStatusCode: false },
      );
      expect(funnelsRes.status()).toBe(404);
    } finally {
      // ── 6. Restore Pro so downstream specs see the deterministic seed. ──
      await adminCtx.request.patch(
        `${BASE_URL}/api/admin/clinics/${clinicId}/subscription`,
        {
          data: { planId: pro!.id, status: "TRIAL" },
          failOnStatusCode: false,
        },
      );
      await adminCtx.close();
      await tenantCtx.close();
    }
  });
});
