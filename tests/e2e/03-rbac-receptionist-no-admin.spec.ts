/**
 * RBAC — RECEPTIONIST cannot touch /admin (platform scope).
 * TZ §10.Фаза 7 scenario #3.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("rbac — receptionist on /admin", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("RECEPTIONIST cannot list platform clinics", async ({
    page,
    request,
  }) => {
    await as.receptionist(page);
    const res = await request.get(`${BASE_URL}/api/platform/clinics`, {
      failOnStatusCode: false,
    });
    expect([401, 403]).toContain(res.status());
  });

  test("RECEPTIONIST cannot create a clinic (platform POST)", async ({
    page,
    request,
  }) => {
    await as.receptionist(page);
    const res = await request.post(`${BASE_URL}/api/platform/clinics`, {
      data: {
        slug: "hack",
        nameRu: "Hack",
        nameUz: "Hack",
        phone: "+998712222222",
        email: "hack@example.com",
      },
      failOnStatusCode: false,
    });
    expect([401, 403]).toContain(res.status());
  });
});
