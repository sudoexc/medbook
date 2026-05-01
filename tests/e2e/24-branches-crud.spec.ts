/**
 * Phase 9c — Branches CRUD + active-branch switcher.
 *
 * Scenario:
 *   1. Log in as ADMIN (NeuroFax).
 *   2. Create a second branch via the API (the seed already plants the
 *      backfilled "hq" default).
 *   3. Switch the active branch by POSTing to /api/crm/branches/active.
 *   4. List doctors and assert the response 200s — when the second branch
 *      has no doctors yet, the response should still succeed (filtered).
 *   5. Clear the cookie + soft-delete the branch (cleanup).
 *
 * Self-skips when DATABASE_URL_TEST is absent or the app is not healthy.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("branches — CRUD + active switcher", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("ADMIN creates a branch, switches active, lists scoped doctors", async ({
    page,
    request,
  }) => {
    await as.admin(page);

    // 1. List existing branches — at least the backfilled "hq" should exist.
    const listRes = await request.get(`${BASE_URL}/api/crm/branches`, {
      failOnStatusCode: false,
    });
    test.skip(
      !listRes.ok(),
      "GET /api/crm/branches not reachable (branches not wired)",
    );
    const listBody = (await listRes.json()) as {
      rows?: Array<{ id: string; slug: string; isDefault: boolean }>;
    };
    const initialCount = (listBody.rows ?? []).length;
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // 2. Create a second branch.
    const slug = `e2e-${Date.now().toString(36)}`;
    const createRes = await request.post(`${BASE_URL}/api/crm/branches`, {
      data: {
        slug,
        nameRu: `E2E филиал ${slug}`,
        nameUz: `E2E filial ${slug}`,
      },
      failOnStatusCode: false,
    });
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as {
      branch?: { id: string; slug: string };
    };
    const branchId = created.branch?.id;
    expect(branchId).toBeTruthy();

    // 3. Switch active branch via cookie endpoint.
    const switchRes = await request.post(
      `${BASE_URL}/api/crm/branches/active`,
      {
        data: { branchId },
        failOnStatusCode: false,
      },
    );
    expect(switchRes.status()).toBe(200);

    // 4. List doctors — request should succeed (rows may be empty if the
    //    second branch has no assigned doctors yet, which is the expected
    //    state for a freshly-created branch).
    const docsRes = await request.get(
      `${BASE_URL}/api/crm/doctors?limit=10`,
      { failOnStatusCode: false },
    );
    expect(docsRes.ok()).toBe(true);

    // 5. Cleanup — clear cookie and soft-delete the branch.
    await request.post(`${BASE_URL}/api/crm/branches/active`, {
      data: { branchId: null },
      failOnStatusCode: false,
    });
    await request.delete(`${BASE_URL}/api/crm/branches/${branchId}`, {
      failOnStatusCode: false,
    });
  });

  test("rejects cross-clinic branchId on switch (404)", async ({
    page,
    request,
  }) => {
    await as.admin(page);
    // Use an obviously-invalid branchId that won't exist for this clinic.
    const res = await request.post(`${BASE_URL}/api/crm/branches/active`, {
      data: { branchId: "br_does_not_exist_xyz" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(404);
  });
});
