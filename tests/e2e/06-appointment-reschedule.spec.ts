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

  test("PATCH moves the appointment; premature NO_SHOW is rejected; cancel works", async ({
    page,
    request,
  }) => {
    await as.admin(page, { request });
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
          services: [{ serviceId: service!.id, quantity: 1 }],
          // Two-lanes: WALKIN is rejected on the booking path (registerWalkin only).
          channel: "PHONE",
        },
        failOnStatusCode: false,
      },
    );
    expect([200, 201]).toContain(createRes.status());
    const { id } = (await createRes.json()) as { id: string };

    // Reschedule 2h later. The stored `time` (HH:MM wall-clock) is the
    // authoritative slot time — a PATCH carrying only `date` keeps the old
    // wall-clock and silently no-ops a same-day move, so `time` MUST be sent.
    const later = new Date(when.getTime() + 2 * 60 * 60 * 1000);
    const laterHM = `${String(later.getHours()).padStart(2, "0")}:${String(
      later.getMinutes(),
    ).padStart(2, "0")}`;
    const patchRes = await request.patch(
      `${BASE_URL}/api/crm/appointments/${id}`,
      {
        data: { date: later.toISOString(), time: laterHM },
        failOnStatusCode: false,
      },
    );
    expect(patchRes.ok()).toBeTruthy();
    const patched = (await patchRes.json()) as { date?: string };
    expect(new Date(patched.date ?? 0).getTime()).toBe(later.getTime());

    // Lifecycle guard: NO_SHOW on a still-future appointment is rejected
    // (the sweep/reception can only no-show once the slot time has passed).
    const noShowRes = await request.patch(
      `${BASE_URL}/api/crm/appointments/${id}`,
      { data: { status: "NO_SHOW" }, failOnStatusCode: false },
    );
    expect(noShowRes.status()).toBe(409);
    const noShowBody = (await noShowRes.json()) as { reason?: string };
    expect(noShowBody.reason).toBe("too_early_for_no_show");

    // Terminal transition that IS allowed ahead of time: cancellation.
    const cancelRes = await request.patch(
      `${BASE_URL}/api/crm/appointments/${id}`,
      {
        data: { status: "CANCELLED", cancelReason: "e2e cleanup" },
        failOnStatusCode: false,
      },
    );
    expect(cancelRes.ok()).toBeTruthy();
    const cancelBody = (await cancelRes.json()) as { status?: string };
    expect(cancelBody.status).toBe("CANCELLED");
  });
});
