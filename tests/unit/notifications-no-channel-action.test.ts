/**
 * Wave 4 of `docs/TZ-sms-removal.md` — PATIENT_NO_CHANNEL compensator.
 *
 * Verifies that `recordPatientNoChannel`:
 *   1. Creates a PATIENT_NO_CHANNEL action with the expected payload shape
 *      (including the UTC-day `bucket` field that drives 24h dedupe).
 *   2. Defaults the deeplink to `/crm/patients/<id>` so the receptionist
 *      lands on the patient card with the phone number visible.
 *   3. Publishes `action.created` realtime event when a fresh row is
 *      inserted.
 *   4. Does NOT publish on a no-op upsert (same bucket, same trigger).
 *   5. Publishes `action.updated` when severity or payload changes.
 *   6. Swallows errors from `upsertAction` so the materializer never bombs
 *      when the DB hiccups — the original code path silently skipped, this
 *      helper preserves that contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertMock = vi.fn();
const publishMock = vi.fn();
const runWithTenantMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {} as never,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (ctx: unknown, fn: () => unknown) => {
    runWithTenantMock(ctx);
    return fn();
  },
}));

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: (...args: unknown[]) => publishMock(...args),
}));

vi.mock("@/server/actions/repository", () => ({
  upsertAction: (...args: unknown[]) => upsertMock(...args),
}));

const { recordPatientNoChannel } = await import(
  "@/server/notifications/no-channel-action"
);

const clinicId = "c_clinic_1";
const patientId = "p_patient_1";
const baseParams = {
  clinicId,
  patientId,
  patientName: "Иван Иванов",
  triggerKey: "appointment.reminder-24h",
  appointmentId: "a_appt_1",
  appointmentAt: new Date("2026-06-09T09:30:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  upsertMock.mockResolvedValue({
    id: "act_1",
    created: true,
    severity: "medium",
    payloadChanged: false,
    severityChanged: false,
  });
  publishMock.mockReturnValue(undefined);
});

describe("recordPatientNoChannel", () => {
  it("inserts a PATIENT_NO_CHANNEL action with full payload + UTC bucket", async () => {
    const now = new Date("2026-06-08T12:00:00.000Z");
    await recordPatientNoChannel({ ...baseParams, now });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [prismaArg, clinicArg, payload, options] = upsertMock.mock.calls[0]!;
    expect(prismaArg).toBeDefined();
    expect(clinicArg).toBe(clinicId);
    expect(payload).toMatchObject({
      type: "PATIENT_NO_CHANNEL",
      patientId,
      patientName: "Иван Иванов",
      triggerKey: "appointment.reminder-24h",
      appointmentId: "a_appt_1",
      appointmentAt: "2026-06-09T09:30:00.000Z",
      bucket: "2026-06-08",
    });
    expect(options).toMatchObject({
      deeplinkPath: `/crm/patients/${patientId}`,
    });
  });

  it("runs the upsert inside a SYSTEM tenant context", async () => {
    await recordPatientNoChannel(baseParams);
    expect(runWithTenantMock).toHaveBeenCalledTimes(1);
    expect(runWithTenantMock).toHaveBeenCalledWith({ kind: "SYSTEM" });
  });

  it("emits action.created on a fresh insert", async () => {
    upsertMock.mockResolvedValueOnce({
      id: "act_new",
      created: true,
      severity: "medium",
      payloadChanged: false,
      severityChanged: false,
    });
    await recordPatientNoChannel(baseParams);
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(clinicId, {
      type: "action.created",
      payload: {
        id: "act_new",
        type: "PATIENT_NO_CHANNEL",
        severity: "medium",
      },
    });
  });

  it("emits action.updated when payload changes on an existing row", async () => {
    upsertMock.mockResolvedValueOnce({
      id: "act_existing",
      created: false,
      severity: "medium",
      payloadChanged: true,
      severityChanged: false,
    });
    await recordPatientNoChannel(baseParams);
    expect(publishMock).toHaveBeenCalledWith(clinicId, {
      type: "action.updated",
      payload: {
        id: "act_existing",
        type: "PATIENT_NO_CHANNEL",
        severity: "medium",
      },
    });
  });

  it("does NOT emit a realtime event on a no-op upsert (dedupe hit)", async () => {
    upsertMock.mockResolvedValueOnce({
      id: "act_existing",
      created: false,
      severity: "medium",
      payloadChanged: false,
      severityChanged: false,
    });
    await recordPatientNoChannel(baseParams);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("defaults appointment fields to null when omitted (e.g. birthday-style triggers)", async () => {
    const now = new Date("2026-06-08T12:00:00.000Z");
    await recordPatientNoChannel({
      clinicId,
      patientId,
      patientName: "Аноним",
      triggerKey: "birthday",
      now,
    });
    const payload = upsertMock.mock.calls[0]?.[2];
    expect(payload).toMatchObject({
      type: "PATIENT_NO_CHANNEL",
      triggerKey: "birthday",
      appointmentId: null,
      appointmentAt: null,
      bucket: "2026-06-08",
    });
  });

  it("uses a stable UTC bucket — two calls on the same UTC day share a dedupe key", async () => {
    const earlyMorning = new Date("2026-06-08T00:30:00.000Z");
    const lateEvening = new Date("2026-06-08T23:45:00.000Z");
    await recordPatientNoChannel({ ...baseParams, now: earlyMorning });
    await recordPatientNoChannel({ ...baseParams, now: lateEvening });
    const b1 = upsertMock.mock.calls[0]?.[2]?.bucket;
    const b2 = upsertMock.mock.calls[1]?.[2]?.bucket;
    expect(b1).toBe("2026-06-08");
    expect(b2).toBe("2026-06-08");
  });

  it("respects a deeplinkPath override (e.g. point at the call queue instead)", async () => {
    await recordPatientNoChannel({
      ...baseParams,
      deeplinkPath: "/crm/call-center",
    });
    const options = upsertMock.mock.calls[0]?.[3];
    expect(options).toMatchObject({ deeplinkPath: "/crm/call-center" });
  });

  it("swallows errors from upsertAction so the materializer keeps running", async () => {
    upsertMock.mockRejectedValueOnce(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordPatientNoChannel(baseParams),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
