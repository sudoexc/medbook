/**
 * «Позвать регистратуру» (owner request 09.10.2026): the doctor's button,
 * the reception's full-screen call and «Иду».
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";
import { EVENT_TYPES, StaffCallPayload } from "@/server/realtime/events";
import {
  STAFF_CALL_ACK_SHOWN_MS,
  STAFF_CALL_OPEN_MS,
  canAnswerStaffCall,
  doctorCallState,
  isStaffCallAlertRole,
  isStaffCallLive,
} from "@/lib/staff-calls";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const NOW = Date.parse("2026-10-09T08:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("who", () => {
  it("the call takes over the desk's and the nurse's screens, not the admin's or the doctor's", () => {
    expect(isStaffCallAlertRole("RECEPTIONIST")).toBe(true);
    expect(isStaffCallAlertRole("NURSE")).toBe(true);
    for (const r of ["ADMIN", "SUPER_ADMIN", "DOCTOR", "CALL_OPERATOR", null]) {
      expect(isStaffCallAlertRole(r), String(r)).toBe(false);
    }
  });

  it("the desk, the nurse and the admins may answer; a doctor may not", () => {
    for (const r of ["RECEPTIONIST", "NURSE", "ADMIN", "SUPER_ADMIN"]) expect(canAnswerStaffCall(r)).toBe(true);
    expect(canAnswerStaffCall("DOCTOR")).toBe(false);
  });
});

describe("when", () => {
  it("rings while open and younger than the window", () => {
    expect(isStaffCallLive({ status: "OPEN", createdAt: ago(60_000) }, NOW)).toBe(true);
    expect(isStaffCallLive({ status: "OPEN", createdAt: ago(STAFF_CALL_OPEN_MS + 1) }, NOW)).toBe(false);
    expect(isStaffCallLive({ status: "ACKED", createdAt: ago(60_000) }, NOW)).toBe(false);
    expect(isStaffCallLive({ status: "CANCELLED", createdAt: ago(60_000) }, NOW)).toBe(false);
  });

  it("the doctor's button: idle, calling, then «идёт» for a while", () => {
    expect(doctorCallState(null, NOW)).toBe("idle");
    expect(doctorCallState({ status: "OPEN", createdAt: ago(30_000), ackedAt: null }, NOW)).toBe("calling");
    expect(
      doctorCallState({ status: "ACKED", createdAt: ago(90_000), ackedAt: ago(30_000) }, NOW),
    ).toBe("coming");
    expect(
      doctorCallState(
        { status: "ACKED", createdAt: ago(STAFF_CALL_ACK_SHOWN_MS * 2), ackedAt: ago(STAFF_CALL_ACK_SHOWN_MS + 1) },
        NOW,
      ),
    ).toBe("idle");
    expect(doctorCallState({ status: "OPEN", createdAt: ago(STAFF_CALL_OPEN_MS + 1), ackedAt: null }, NOW)).toBe(
      "idle",
    );
  });
});

describe("the live event", () => {
  it("is a known type carrying no patient data", () => {
    expect(EVENT_TYPES).toContain("staff-call.updated");
    const ok = StaffCallPayload.safeParse({
      callId: "c1",
      doctorId: "d1",
      doctorName: "Султанов Азиз",
      cabinet: "5",
      status: "ACKED",
      ackedByName: "Регистратура",
    });
    expect(ok.success).toBe(true);
    expect(StaffCallPayload.safeParse({ callId: "c1", doctorId: "d1", status: "SOMETHING" }).success).toBe(false);
  });
});

describe("wiring", () => {
  it("the API: doctors call and cancel, the desk answers, conditionally", () => {
    const list = read("src/app/api/crm/staff-calls/route.ts");
    expect(list).toContain("roles: [...STAFF_CALL_CALLER_ROLES]");
    expect(list).toContain("const row =\n      ringing ??");
    const ack = read("src/app/api/crm/staff-calls/[id]/ack/route.ts");
    expect(ack).toContain("roles: [...STAFF_CALL_ANSWER_ROLES]");
    expect(ack).toContain('where: { id, status: "OPEN", createdAt: { gte: staffCallOpenSince(now) } }');
    expect(ack).toContain('err("StaffCallClosed", 409');
    const cancel = read("src/app/api/crm/staff-calls/[id]/cancel/route.ts");
    expect(cancel).toContain('where: { id, doctorId: doctor.id, status: "OPEN" }');
  });

  it("the doctor's top bar has the button; the CRM layout mounts the full-screen call", () => {
    expect(read("src/app/[locale]/doctor/_components/doctor-topbar.tsx")).toContain("<StaffCallButton />");
    expect(read("src/app/[locale]/crm/layout.tsx")).toContain(
      "<GlobalStaffCallAlerts enabled={isStaffCallAlertRole(session?.user?.role)} />",
    );
    // Above the iPad page (z-40) and everything else.
    expect(read("src/components/staff-calls/global-staff-call-alerts.tsx")).toContain("fixed inset-0 z-[200]");
  });

  it("the migration is additive", () => {
    const sql = read("prisma/migrations/20261009100000_staff_calls/migration.sql");
    expect(sql).toContain('CREATE TABLE "StaffCall"');
    expect(sql).not.toMatch(/DROP|ALTER TABLE "(?!StaffCall)/);
  });

  it("texts in both languages, no dashes", () => {
    const keys = Object.keys(ru.staffCall).sort();
    expect(Object.keys(uz.staffCall).sort()).toEqual(keys);
    for (const m of [ru, uz]) for (const v of Object.values(m.staffCall)) expect(v).not.toMatch(/[—–]/);
  });
});
