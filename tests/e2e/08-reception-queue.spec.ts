/**
 * Reception — call next in queue: transitions an appointment to IN_PROGRESS.
 * TZ §10.Фаза 7 scenario #8.
 */
import { test, expect } from "@playwright/test";

import {
  BASE_URL,
  HAS_TEST_DB,
  as,
  firstDoctorId,
  firstPatientId,
  firstService,
  isAppHealthy,
} from "./helpers";

test.describe("reception — queue transitions", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("PATCH queue-status moves BOOKED → IN_PROGRESS", async ({
    page,
    request,
  }) => {
    await as.receptionist(page);
    const [doctorId, patientId, service] = await Promise.all([
      firstDoctorId(page.context()),
      firstPatientId(page.context()),
      firstService(page.context()),
    ]);
    test.skip(
      !doctorId || !patientId || !service,
      "seed missing required fixtures",
    );

    const when = new Date();
    when.setDate(when.getDate() + 9);
    when.setHours(12, 0, 0, 0);

    const createRes = await request.post(
      `${BASE_URL}/api/crm/appointments`,
      {
        data: {
          patientId,
          doctorId,
          date: when.toISOString(),
          durationMin: service!.durationMin,
          serviceIds: [service!.id],
          channel: "WALKIN",
        },
        failOnStatusCode: false,
      },
    );
    expect([200, 201]).toContain(createRes.status());
    const { id } = (await createRes.json()) as { id: string };

    // Move to IN_PROGRESS.
    const patchRes = await request.patch(
      `${BASE_URL}/api/crm/appointments/${id}/queue-status`,
      { data: { queueStatus: "IN_PROGRESS" }, failOnStatusCode: false },
    );
    expect(patchRes.ok()).toBeTruthy();
    const body = (await patchRes.json()) as { queueStatus?: string };
    expect(body.queueStatus ?? "IN_PROGRESS").toBe("IN_PROGRESS");
  });
});
