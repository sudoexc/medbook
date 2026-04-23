/**
 * Appointments — create, then double-book → 409 conflict. TZ §10.Фаза 7 scenario #5.
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

test.describe("appointments — conflict detection", () => {
  test.beforeAll(async () => {
    test.skip(!HAS_TEST_DB, "requires seeded test DB (DATABASE_URL_TEST)");
    const healthy = await isAppHealthy();
    test.skip(!healthy, "webServer reachable but DB health check failed");
  });

  test("create succeeds, overlapping create returns 409 conflict", async ({
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
      "seed missing required fixtures (doctor/patient/service)",
    );

    // Pick a deterministic future slot (9am local on a future weekday so
    // we stay inside the seed's Mon–Fri 09:00–18:00 window).
    const when = new Date();
    // Advance 7 days so we don't collide with the 10–14 seed slots.
    when.setDate(when.getDate() + 7);
    when.setHours(9, 0, 0, 0);

    const payload = {
      patientId,
      doctorId,
      date: when.toISOString(),
      durationMin: service!.durationMin,
      serviceIds: [service!.id],
      channel: "WALKIN",
    };

    const createRes = await request.post(
      `${BASE_URL}/api/crm/appointments`,
      { data: payload, failOnStatusCode: false },
    );
    expect([200, 201]).toContain(createRes.status());

    // Second identical POST must return 409 conflict.
    const dupRes = await request.post(`${BASE_URL}/api/crm/appointments`, {
      data: payload,
      failOnStatusCode: false,
    });
    expect(dupRes.status()).toBe(409);
    const dupBody = (await dupRes.json()) as {
      error: string;
      reason?: string;
    };
    expect(dupBody.error).toBe("conflict");
    expect([
      "doctor_busy",
      "cabinet_busy",
      "doctor_time_off",
      "outside_schedule",
    ]).toContain(dupBody.reason ?? "doctor_busy");
  });
});
