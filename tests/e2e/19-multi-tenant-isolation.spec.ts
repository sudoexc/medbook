/**
 * Multi-tenancy — clinic A user cannot read clinic B's patients via the API.
 * TZ §10.Фаза 7 scenario #19.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";
import { DEMO_CLINIC, PATIENT_PHONES } from "./fixtures/seed-handles";

test.describe("multi-tenancy isolation", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("neurofax admin cannot see demo-clinic patients", async ({
    page,
    request,
  }) => {
    await as.admin(page);
    // Try to search for a phone that only exists in the demo clinic.
    const demoOnlyPhone = PATIENT_PHONES["demo-clinic"][0];
    const res = await request.get(
      `${BASE_URL}/api/crm/patients?q=${encodeURIComponent(demoOnlyPhone)}`,
      { failOnStatusCode: false },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      rows?: Array<{ phoneNormalized?: string }>;
    };
    const leaked = (body.rows ?? []).some(
      (r) => r.phoneNormalized === demoOnlyPhone,
    );
    expect(leaked).toBeFalsy();
  });

  test("demo-clinic admin CAN see their own patients (positive control)", async ({
    page,
    request,
  }) => {
    void DEMO_CLINIC;
    await as.otherClinicAdmin(page);
    const demoOnlyPhone = PATIENT_PHONES["demo-clinic"][0];
    const res = await request.get(
      `${BASE_URL}/api/crm/patients?q=${encodeURIComponent(demoOnlyPhone)}`,
      { failOnStatusCode: false },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      rows?: Array<{ phoneNormalized?: string }>;
    };
    expect(
      (body.rows ?? []).some((r) => r.phoneNormalized === demoOnlyPhone),
    ).toBeTruthy();
  });
});
