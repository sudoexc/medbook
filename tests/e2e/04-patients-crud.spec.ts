/**
 * Patients — create → list → edit inline → soft-delete. TZ §10.Фаза 7 scenario #4.
 *
 * Exercises the REST API behind the UI (the same paths the
 * `new-patient-dialog` and `patient-header` components call).
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("patients — CRUD lifecycle", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("create, list, edit, soft-delete a patient", async ({
    page,
    request,
  }) => {
    await as.admin(page);

    // 1. Create
    const unique = `E2E Patient ${Date.now()}`;
    const phone = `+99890${Math.floor(1000000 + Math.random() * 8999999)}`;
    const createRes = await request.post(`${BASE_URL}/api/crm/patients`, {
      data: {
        fullName: unique,
        phone,
        gender: "FEMALE",
        source: "WALKIN",
      },
      failOnStatusCode: false,
    });
    expect([200, 201]).toContain(createRes.status());
    const created = (await createRes.json()) as { id: string };
    expect(created.id).toBeTruthy();

    // 2. List — patient appears (search by unique name)
    const listRes = await request.get(
      `${BASE_URL}/api/crm/patients?q=${encodeURIComponent(unique)}`,
      { failOnStatusCode: false },
    );
    expect(listRes.ok()).toBeTruthy();
    const listBody = (await listRes.json()) as {
      rows: Array<{ id: string; fullName: string }>;
    };
    expect(listBody.rows.some((r) => r.id === created.id)).toBeTruthy();

    // 3. Inline edit — rename
    const editRes = await request.patch(
      `${BASE_URL}/api/crm/patients/${created.id}`,
      {
        data: { fullName: `${unique} — Updated` },
        failOnStatusCode: false,
      },
    );
    expect(editRes.ok()).toBeTruthy();

    // 4. Soft-delete
    const delRes = await request.delete(
      `${BASE_URL}/api/crm/patients/${created.id}`,
      { failOnStatusCode: false },
    );
    expect([200, 204]).toContain(delRes.status());

    // 5. Verify soft-delete: the row no longer appears in the default list.
    const afterRes = await request.get(
      `${BASE_URL}/api/crm/patients?q=${encodeURIComponent(unique)}`,
      { failOnStatusCode: false },
    );
    const afterBody = (await afterRes.json()) as {
      rows: Array<{ id: string }>;
    };
    expect(afterBody.rows.some((r) => r.id === created.id)).toBeFalsy();
  });
});
