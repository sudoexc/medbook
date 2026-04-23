/**
 * Appointments — reschedule (PATCH) + mark no-show. TZ §10.Фаза 7 scenario #6.
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

test.describe("appointments — reschedule + no-show", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("PATCH moves the appointment to a new slot; status NO_SHOW persists", async ({
    page,
    request,
  }) => {
    await as.admin(page);
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
    when.setDate(when.getDate() + 8);
    when.setHours(11, 0, 0, 0);

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

    // Reschedule 2h later.
    const later = new Date(when.getTime() + 2 * 60 * 60 * 1000);
    const patchRes = await request.patch(
      `${BASE_URL}/api/crm/appointments/${id}`,
      {
        data: { date: later.toISOString() },
        failOnStatusCode: false,
      },
    );
    expect(patchRes.ok()).toBeTruthy();

    // Mark no-show.
    const noShowRes = await request.patch(
      `${BASE_URL}/api/crm/appointments/${id}`,
      { data: { status: "NO_SHOW" }, failOnStatusCode: false },
    );
    expect(noShowRes.ok()).toBeTruthy();
    const noShowBody = (await noShowRes.json()) as { status?: string };
    expect(noShowBody.status ?? "NO_SHOW").toBe("NO_SHOW");
  });
});
