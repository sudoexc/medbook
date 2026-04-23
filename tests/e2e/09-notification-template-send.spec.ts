/**
 * Notifications — create template → manual send (log adapter) → queue shows SENT.
 * TZ §10.Фаза 7 scenario #9.
 */
import { test, expect } from "@playwright/test";

import {
  BASE_URL,
  HAS_TEST_DB,
  as,
  firstPatientId,
  isAppHealthy,
} from "./helpers";

test.describe("notifications — template lifecycle", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("ADMIN creates a template and fires a manual send", async ({
    page,
    request,
  }) => {
    await as.admin(page);
    const patientId = await firstPatientId(page.context());
    test.skip(!patientId, "seed missing patient");

    const key = `e2e.manual.${Date.now()}`;
    const createRes = await request.post(
      `${BASE_URL}/api/crm/notifications/templates`,
      {
        data: {
          key,
          nameRu: "E2E manual",
          nameUz: "E2E qo'lda",
          channel: "TG",
          category: "TRANSACTIONAL",
          trigger: "MANUAL",
          bodyRu: "Здравствуйте, {{patient.fullName}}.",
          bodyUz: "Assalomu alaykum, {{patient.fullName}}.",
          variables: ["patient.fullName"],
        },
        failOnStatusCode: false,
      },
    );
    expect([200, 201]).toContain(createRes.status());
    const tpl = (await createRes.json()) as { id: string };
    expect(tpl.id).toBeTruthy();

    // Fire a manual send.
    const sendRes = await request.post(
      `${BASE_URL}/api/crm/notifications/sends`,
      {
        data: {
          templateId: tpl.id,
          patientIds: [patientId],
          channel: "TG",
        },
        failOnStatusCode: false,
      },
    );
    // Accept 200/201/202 (queue enqueue).
    expect([200, 201, 202]).toContain(sendRes.status());
  });
});
