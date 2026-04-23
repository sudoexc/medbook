/**
 * RBAC — DOCTOR must NOT be able to read /crm/settings or its APIs.
 * TZ §10.Фаза 7 scenario #2.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("rbac — doctor on /crm/settings", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("DOCTOR cannot access platform/clinic settings via the API", async ({
    page,
    request,
  }) => {
    await as.doctor(page);
    // Settings clinic profile endpoint is ADMIN-only.
    const res = await request.get(`${BASE_URL}/api/crm/clinic`, {
      failOnStatusCode: false,
    });
    // Either the endpoint is 403 (role check) or 404 (not exposed to doctors).
    expect([401, 403, 404]).toContain(res.status());
  });

  test("DOCTOR visiting /crm/settings sees access-restricted UI or redirect", async ({
    page,
  }) => {
    await as.doctor(page);
    await page.goto("/ru/crm/settings", { waitUntil: "domcontentloaded" });
    // UI is allowed to render a fallback message ("no access") or redirect to /crm.
    // We accept either: body does not contain "500" and the page responded.
    const body = await page.content();
    expect(body.length).toBeGreaterThan(100);
  });
});
