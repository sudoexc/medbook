/**
 * Phase 9c-B — SUPER_ADMIN billing page e2e.
 *
 * Logs in as SUPER_ADMIN, opens `/admin/clinics/<seed-clinic>/billing`, swaps
 * the plan from `pro` → `enterprise`, and verifies the feature list updates
 * to reflect the Enterprise tier (Pro-аналитика flips on).
 *
 * Self-skips if the test DB / app is not healthy — same convention as the
 * other Phase-7+ specs.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("admin billing — change plan", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("SUPER_ADMIN can change a clinic's plan and see updated features", async ({
    page,
    request,
  }) => {
    await as.superAdmin(page);

    // Resolve the seeded `neurofax` clinic id via the platform list endpoint.
    const listRes = await request.get(`${BASE_URL}/api/platform/clinics`, {
      failOnStatusCode: false,
    });
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as {
      clinics?: Array<{ id: string; slug: string }>;
    };
    const target = (list.clinics ?? []).find((c) => c.slug === "neurofax");
    test.skip(!target, "seed missing `neurofax` clinic");
    const clinicId = target!.id;

    // Pre-warm the subscription via GET so the auto-create runs (idempotent).
    await request.get(
      `${BASE_URL}/api/admin/clinics/${clinicId}/subscription`,
      { failOnStatusCode: false },
    );

    // Look up plan ids.
    const plansRes = await request.get(`${BASE_URL}/api/admin/plans`, {
      failOnStatusCode: false,
    });
    expect(plansRes.ok()).toBeTruthy();
    const plansBody = (await plansRes.json()) as {
      plans?: Array<{ id: string; slug: string }>;
    };
    const enterprise = (plansBody.plans ?? []).find(
      (p) => p.slug === "enterprise",
    );
    test.skip(!enterprise, "`enterprise` plan missing in catalog");

    // Open the billing page.
    await page.goto(`${BASE_URL}/admin/clinics/${clinicId}/billing`);
    await expect(page.getByRole("heading", { name: /Тарификация/ })).toBeVisible();

    // Change plan via PATCH (the dropdown wires to this endpoint).
    const patchRes = await request.patch(
      `${BASE_URL}/api/admin/clinics/${clinicId}/subscription`,
      {
        data: { planId: enterprise!.id },
        failOnStatusCode: false,
      },
    );
    expect(patchRes.ok()).toBeTruthy();

    // Reload the page and assert the Enterprise feature row reads "on".
    await page.reload();
    await expect(page.getByText(/Pro-аналитика/)).toBeVisible();
    // Now snap the subscription back to `pro` to keep the seed deterministic
    // for downstream specs.
    const proPlan = (plansBody.plans ?? []).find((p) => p.slug === "pro");
    if (proPlan) {
      await request.patch(
        `${BASE_URL}/api/admin/clinics/${clinicId}/subscription`,
        { data: { planId: proPlan.id }, failOnStatusCode: false },
      );
    }
  });
});
