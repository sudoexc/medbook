/**
 * Admin platform — SUPER_ADMIN creates a clinic; then switches tenant scope.
 * TZ §10.Фаза 7 scenario #18.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("admin platform — clinic lifecycle", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("SUPER_ADMIN can list + create clinics", async ({ page, request }) => {
    await as.superAdmin(page);
    const listRes = await request.get(`${BASE_URL}/api/platform/clinics`, {
      failOnStatusCode: false,
    });
    expect(listRes.ok()).toBeTruthy();

    const slug = `e2e-${Date.now()}`;
    const createRes = await request.post(
      `${BASE_URL}/api/platform/clinics`,
      {
        data: {
          slug,
          nameRu: `E2E Clinic ${slug}`,
          nameUz: `E2E Klinika ${slug}`,
          timezone: "Asia/Tashkent",
          currency: "UZS",
          secondaryCurrency: "USD",
          phone: "+998712000999",
          email: `${slug}@example.com`,
          brandColor: "#3DD5C0",
        },
        failOnStatusCode: false,
      },
    );
    expect([200, 201]).toContain(createRes.status());

    // Verify it shows up in list.
    const afterRes = await request.get(`${BASE_URL}/api/platform/clinics`, {
      failOnStatusCode: false,
    });
    const body = (await afterRes.json()) as {
      clinics?: Array<{ slug: string }>;
    };
    expect((body.clinics ?? []).some((c) => c.slug === slug)).toBeTruthy();
  });
});
