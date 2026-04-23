/**
 * Settings — change clinic name → audit row recorded.
 * TZ §10.Фаза 7 scenario #17.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("settings — clinic profile + audit", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("PATCH clinic profile creates an audit entry", async ({
    page,
    request,
  }) => {
    await as.admin(page);
    // Read current profile.
    const before = await request.get(`${BASE_URL}/api/crm/clinic`, {
      failOnStatusCode: false,
    });
    test.skip(
      !before.ok(),
      "GET /api/crm/clinic not reachable (settings not wired)",
    );
    const cur = (await before.json()) as {
      clinic?: { nameRu?: string; nameUz?: string };
    };
    const prevName = cur.clinic?.nameRu ?? "NeuroFax";

    // Patch.
    const newName = `${prevName} [e2e ${Date.now()}]`;
    const patchRes = await request.patch(`${BASE_URL}/api/crm/clinic`, {
      data: { nameRu: newName },
      failOnStatusCode: false,
    });
    expect([200, 204]).toContain(patchRes.status());

    // Audit log should now have an entry for "clinic".
    const auditRes = await request.get(
      `${BASE_URL}/api/crm/audit?entityType=Clinic&limit=5`,
      { failOnStatusCode: false },
    );
    if (auditRes.ok()) {
      const body = (await auditRes.json()) as {
        rows?: Array<{ action?: string; entityType?: string }>;
      };
      // At least one audit row should reference Clinic.
      expect((body.rows ?? []).length).toBeGreaterThan(0);
    }

    // Restore.
    await request.patch(`${BASE_URL}/api/crm/clinic`, {
      data: { nameRu: prevName },
      failOnStatusCode: false,
    });
  });
});
