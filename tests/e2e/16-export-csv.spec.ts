/**
 * CSV export — enqueue → poll → DONE with download URL.
 * TZ §10.Фаза 7 scenario #16.
 */
import { test, expect } from "@playwright/test";

import { BASE_URL, HAS_TEST_DB, as, isAppHealthy } from "./helpers";

test.describe("csv export worker", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("ADMIN enqueues a patients export; poll reaches DONE", async ({
    page,
    request,
  }) => {
    await as.admin(page);
    const enq = await request.post(`${BASE_URL}/api/crm/exports`, {
      data: { kind: "patients", filters: {} },
      failOnStatusCode: false,
    });
    expect([200, 201, 202]).toContain(enq.status());
    const { jobId } = (await enq.json()) as { jobId: string };
    expect(jobId).toBeTruthy();

    // Poll up to 15s.
    let done = false;
    const start = Date.now();
    while (Date.now() - start < 15_000) {
      const status = await request.get(
        `${BASE_URL}/api/crm/exports/${jobId}`,
        { failOnStatusCode: false },
      );
      expect(status.ok()).toBeTruthy();
      const body = (await status.json()) as {
        status?: string;
        url?: string;
      };
      if (body.status === "DONE") {
        done = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(done).toBeTruthy();
  });
});
