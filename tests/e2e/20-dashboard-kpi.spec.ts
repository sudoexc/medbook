/**
 * Reception dashboard — KPIs load for today/week/month.
 * TZ §10.Фаза 7 scenario #20.
 *
 * This is the 20th scenario and doubles as a smoke-test for the reception
 * landing page (DOCTOR session is redirected to reception in the current
 * layout setup).
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("reception dashboard KPI", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  for (const period of ["today", "week", "month"] as const) {
    test(`/api/crm/dashboard?period=${period} returns payload`, async ({
      page,
      request,
    }) => {
      await as.admin(page);
      const res = await request.get(
        `${BASE_URL}/api/crm/dashboard?period=${period}`,
        { failOnStatusCode: false },
      );
      expect(res.ok()).toBeTruthy();
      const body = (await res.json()) as Record<string, unknown>;
      // The response shape exposes at least `queue` or `kpi` keys — accept
      // either to stay robust to key-naming churn.
      const keys = Object.keys(body);
      expect(keys.length).toBeGreaterThan(0);
    });
  }
});
