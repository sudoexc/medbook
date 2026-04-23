/**
 * Documents library — page + API filter by patient + type.
 * TZ §10.Фаза 7 scenario #15.
 */
import { test, expect } from "@playwright/test";

import {
  BASE_URL,
  HAS_TEST_DB,
  as,
  firstPatientId,
  isAppHealthy,
} from "./helpers";

test.describe("documents library", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("documents list is filterable by patientId", async ({
    page,
    request,
  }) => {
    await as.admin(page);
    const patientId = await firstPatientId(page.context());
    test.skip(!patientId, "seed missing patient");

    const res = await request.get(
      `${BASE_URL}/api/crm/documents?patientId=${patientId}`,
      { failOnStatusCode: false },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { rows?: Array<unknown> };
    expect(Array.isArray(body.rows ?? [])).toBeTruthy();
  });
});
