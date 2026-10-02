/**
 * Live sync of the small realtime gaps from the 2026-09-25 audit (P6, C7):
 *
 *   - G3-09: confirm and auto no-show events name the patient, so the Mini
 *     App stream (which delivers only events naming one of its patients)
 *     carries them;
 *   - G3-10: an open appointment card refetches on its own appointment's
 *     events, not only after the viewer's own mutation;
 *   - G3-11: «Риск на сегодня» and «К подтверждению» hear confirms, cancels
 *     and moves;
 *   - G3-12: a visit moved to another doctor names the previous doctor too,
 *     and his «Мой день», agenda and door board accept it;
 *   - G3-13: a CRM attach or detach announces the re-priced visits;
 *   - G3-14: notification.sent for an in-app send is no longer dropped by
 *     the CRM client.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { CommunicationChannel } from "@/generated/prisma/enums";
import { parseLiveEvent } from "@/hooks/use-live-events";
import { boardEventConcerns } from "@/hooks/use-doctor-board";
import {
  eventDoctorIds,
  previousDoctorField,
} from "@/lib/appointments/event-doctors";
import { NotificationPayload, type AppEvent } from "@/server/realtime/events";
import { projectBoardEvent } from "@/server/realtime/board-stream";
import { emitAppointmentChangeViaOutbox } from "@/server/appointments/emit-change";
import { staffCaseActor } from "@/server/cases/attach";
import { shouldDeliverV1ToMiniApp } from "@/app/api/miniapp/events/route";
import {
  APPOINTMENT_DETAIL_LIVE_EVENTS,
  eventNamesAppointment,
} from "@/app/[locale]/crm/appointments/_hooks/use-appointment";
import { RISK_TODAY_LIVE_EVENTS } from "@/app/[locale]/crm/action-center/_hooks/use-risk-today";
import { UNCONFIRMED_SAFETY_EVENTS } from "@/app/[locale]/crm/call-center/_hooks/use-unconfirmed";
import { eventTargetsDoctor } from "@/app/[locale]/doctor/my-day/_hooks/use-doctor-today";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

const ev = (type: string, payload: Record<string, unknown>) =>
  ({ type, clinicId: "c1", at: new Date().toISOString(), payload }) as AppEvent;

describe("G3-14: in-app notification events reach the CRM", () => {
  it("parseLiveEvent keeps a v2 notification.sent for an INAPP send", () => {
    const envelope = {
      eventId: "e1",
      correlationId: "corr1",
      at: new Date().toISOString(),
      actor: {
        role: "SYSTEM",
        userId: null,
        patientId: null,
        onBehalfOfPatientId: null,
        label: "system",
      },
      surface: "WORKER",
      tenantScope: { clinicId: "c1", patientId: "p1" },
      type: "notification.sent",
      payload: { sendId: "s1", channel: "INAPP", patientId: "p1" },
    };
    const parsed = parseLiveEvent(envelope);
    expect(parsed?.type).toBe("notification.sent");
    expect(parsed?.clinicId).toBe("c1");
  });

  it("the payload accepts every CommunicationChannel the database can hold", () => {
    for (const channel of Object.values(CommunicationChannel)) {
      expect(
        NotificationPayload.safeParse({ sendId: "s1", channel }).success,
        channel,
      ).toBe(true);
    }
  });
});

describe("G3-09: patient-scoped confirm and no-show events", () => {
  it("a v1 no-show event naming the patient is delivered to his Mini App", () => {
    const allowed = { clinicId: "c1", patientIds: new Set(["p1"]) };
    const base = { type: "queue.updated", clinicId: "c1" };
    expect(
      shouldDeliverV1ToMiniApp(
        { ...base, payload: { appointmentId: "a1", patientId: "p1", queueStatus: "NO_SHOW" } },
        allowed,
      ),
    ).toBe(true);
    // The old payload, without patientId, was dropped.
    expect(
      shouldDeliverV1ToMiniApp({ ...base, payload: { appointmentId: "a1" } }, allowed),
    ).toBe(false);
  });

  it("the sweeper selects and publishes patientId", () => {
    const src = read("src/server/workers/appointment-lifecycle-sweep.ts");
    const scan = src.slice(src.indexOf("where: autoNoShowWhere(cutoff)"));
    expect(scan.slice(0, 200)).toMatch(/patientId: true/);
    expect(src.match(/patientId: row\.patientId/g)?.length).toBe(2);
  });
});

describe("G3-10: the open appointment card follows its appointment", () => {
  it("listens to every event that changes status, time, doctor or price", () => {
    expect(APPOINTMENT_DETAIL_LIVE_EVENTS).toEqual(
      expect.arrayContaining([
        "appointment.updated",
        "appointment.statusChanged",
        "appointment.cancelled",
        "appointment.moved",
        "queue.updated",
      ]),
    );
  });

  it("refetches only for its own appointment id", () => {
    expect(eventNamesAppointment(ev("appointment.cancelled", { appointmentId: "a1" }), "a1")).toBe(true);
    expect(eventNamesAppointment(ev("appointment.cancelled", { appointmentId: "a2" }), "a1")).toBe(false);
    expect(eventNamesAppointment(ev("queue.updated", {}), "a1")).toBe(false);
    expect(eventNamesAppointment(ev("appointment.updated", { appointmentId: "a1" }), null)).toBe(false);
  });
});

describe("G3-11: confirm, cancel and move refresh the call lists", () => {
  it("«Риск на сегодня» hears status changes, cancels, moves and queue shifts", () => {
    expect(RISK_TODAY_LIVE_EVENTS).toEqual(
      expect.arrayContaining([
        "action.created",
        "action.updated",
        "appointment.statusChanged",
        "appointment.cancelled",
        "appointment.moved",
        "queue.updated",
      ]),
    );
  });

  it("«К подтверждению» has a safety net on confirm and cancel", () => {
    expect(UNCONFIRMED_SAFETY_EVENTS).toEqual(
      expect.arrayContaining(["appointment.statusChanged", "appointment.cancelled"]),
    );
  });
});

describe("G3-12: a transfer reaches the previous doctor", () => {
  it("previousDoctorField names the old doctor only when it changed", () => {
    expect(previousDoctorField("d1", "d2")).toEqual({ previousDoctorId: "d1" });
    expect(previousDoctorField("d1", "d1")).toEqual({});
    expect(previousDoctorField(undefined, "d2")).toEqual({});
  });

  it("eventDoctorIds reads both ids and ignores junk", () => {
    expect(eventDoctorIds({ doctorId: "d2", previousDoctorId: "d1" })).toEqual(["d2", "d1"]);
    expect(eventDoctorIds({ doctorId: "d2" })).toEqual(["d2"]);
    expect(eventDoctorIds({ doctorId: "" })).toEqual([]);
    expect(eventDoctorIds(null)).toEqual([]);
  });

  it("«Мой день» and the agenda of the previous doctor take the event", () => {
    const moved = ev("appointment.moved", { appointmentId: "a1", doctorId: "d2", previousDoctorId: "d1" });
    expect(eventTargetsDoctor(moved, "d1")).toBe(true);
    expect(eventTargetsDoctor(moved, "d2")).toBe(true);
    expect(eventTargetsDoctor(moved, "d3")).toBe(false);
    // Unchanged: an unscoped event can't be ruled out.
    expect(eventTargetsDoctor(ev("appointment.moved", { appointmentId: "a1" }), "d3")).toBe(true);
  });

  it("the door board takes it, and the public projection lets the id through", () => {
    const projected = projectBoardEvent({
      type: "queue.updated",
      payload: { appointmentId: "a1", doctorId: "d2", previousDoctorId: "d1", patientId: "p1" },
    });
    expect(projected?.payload).toEqual({ doctorId: "d2", previousDoctorId: "d1" });
    expect(boardEventConcerns(projected!.payload, "d1")).toBe(true);
    expect(boardEventConcerns(projected!.payload, "d3")).toBe(false);
    expect(boardEventConcerns({}, "d3")).toBe(true);
    expect(boardEventConcerns({ doctorId: "d2" }, null)).toBe(false);
  });

  it("emitAppointmentChangeViaOutbox adds previousDoctorId to both envelopes on a transfer", async () => {
    const envelopes: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const tx = {
      eventOutbox: {
        create: async ({ data }: { data: { envelope: { type: string; payload: Record<string, unknown> } } }) => {
          envelopes.push(data.envelope);
          return { id: "o" };
        },
      },
    } as never;
    const base = {
      tx,
      kind: "moved" as const,
      after: {
        id: "a1",
        doctorId: "d2",
        patientId: "p1",
        cabinetId: null,
        status: "WAITING" as const,
        queueStatus: "WAITING" as const,
        date: new Date("2026-10-02T06:00:00Z"),
      },
      clinicId: "c1",
      actorId: "u1",
      actorRole: "RECEPTIONIST" as const,
      actorLabel: "user:u1",
      surface: "CRM" as const,
      correlationId: "corr1",
      alsoQueueUpdate: true,
    };
    await emitAppointmentChangeViaOutbox({
      ...base,
      before: { status: "WAITING", queueStatus: "WAITING", doctorId: "d1" },
    });
    expect(envelopes.map((e) => [e.type, e.payload.previousDoctorId])).toEqual([
      ["appointment.moved", "d1"],
      ["queue.updated", "d1"],
    ]);

    envelopes.length = 0;
    await emitAppointmentChangeViaOutbox({
      ...base,
      before: { status: "WAITING", queueStatus: "WAITING", doctorId: "d2" },
    });
    expect(envelopes.every((e) => !("previousDoctorId" in e.payload))).toBe(true);
  });

  it("the Mini App reschedule names the previous doctor too", () => {
    const src = read("src/server/appointments/patient-reschedule.ts");
    expect(src.match(/previousDoctorField\(before\.doctorId, after\.doctorId\)/g)?.length).toBe(2);
  });
});

describe("G3-13: a CRM attach or detach announces the re-priced visits", () => {
  it("staffCaseActor maps the staff role to the envelope actor and surface", () => {
    const tenant = (role: string) =>
      ({ kind: "TENANT", clinicId: "c1", userId: "u1", role }) as never;
    expect(staffCaseActor(tenant("DOCTOR"), "c1")).toMatchObject({
      clinicId: "c1",
      actor: { role: "DOCTOR", userId: "u1", label: "user:u1" },
      surface: "DOCTOR_CABINET",
    });
    expect(staffCaseActor(tenant("CALL_OPERATOR"), "c1")).toMatchObject({
      actor: { role: "RECEPTIONIST" },
      surface: "CALL_CENTER",
    });
    expect(staffCaseActor(tenant("ADMIN"), "c1")).toMatchObject({
      actor: { role: "ADMIN" },
      surface: "CRM",
    });
  });

  it("both CRM routes publish inside the re-pricing transaction", () => {
    for (const f of [
      "src/app/api/crm/cases/[id]/attach-appointment/route.ts",
      "src/app/api/crm/cases/[id]/detach-appointment/route.ts",
    ]) {
      const src = read(f);
      const tx = src.slice(src.indexOf("prisma.$transaction("));
      const end = tx.indexOf("\n    });");
      expect(tx.slice(0, end), f).toMatch(/await publishCaseRepricing\(/);
    }
  });
});
