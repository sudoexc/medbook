/**
 * Audit AP-03 (create side) and G6-02.
 *
 *   - AP-03: the booking kernel takes the patient and the case from the
 *     client, and the tenant scope filters reads, not the foreign keys it
 *     writes. A patient of another clinic, or a case of another patient, is
 *     now refused (POST 422); a doctor cannot type a price at booking (403).
 *   - G6-02: «Записать» in the Telegram inbox books a TELEGRAM visit, which
 *     is not auto-confirmed, instead of an auto-confirmed PHONE one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "RECEPTIONIST" as string,
  patient: { id: "p1" } as { id: string } | null,
  medicalCase: { id: "case1" } as { id: string } | null,
  patientWhere: [] as unknown[],
  caseWhere: [] as unknown[],
}));

vi.mock("@/lib/api-handler", () => {
  const wrap =
    (
      opts: { bodySchema?: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const raw = await request.json().catch(() => ({}));
      const parsed = opts.bodySchema ? opts.bodySchema.safeParse(raw) : { success: true, data: raw };
      if (!parsed.success) return Response.json({ error: "ValidationError" }, { status: 400 });
      return handler({
        request,
        body: parsed.data,
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u1", role: state.role },
      });
    };
  return { createApiHandler: wrap, createApiListHandler: wrap };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findUnique: vi.fn(async () => ({
        id: "doc_1",
        clinicId: "c1",
        cabinetId: "cab_1",
        isActive: true,
        cabinet: { isActive: true },
      })),
      findFirst: vi.fn(async () => ({ id: "doc_1", isActive: true })),
    },
    patient: {
      findFirst: vi.fn(async (args: { where: unknown }) => {
        state.patientWhere.push(args.where);
        return state.patient;
      }),
    },
    medicalCase: {
      findFirst: vi.fn(async (args: { where: unknown }) => {
        state.caseWhere.push(args.where);
        return state.medicalCase;
      }),
    },
  },
}));

import { bookAppointment, type BookInput } from "@/server/appointments/book";
import { bookingChannelForConversation } from "@/components/appointments/new-appointment-dialog/types";

const input = (over: Partial<BookInput> = {}): BookInput => ({
  clinicId: "c1",
  patientId: "p1",
  doctorId: "doc_1",
  startAt: new Date("2026-10-05T05:00:00.000Z"),
  channel: "PHONE",
  actor: { role: "RECEPTIONIST", userId: "u1", patientId: null, onBehalfOfPatientId: null, label: "user:u1" },
  surface: "CRM",
  ...over,
});

const post = (body: unknown) =>
  new Request("https://x/api/crm/appointments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.role = "RECEPTIONIST";
  state.patient = { id: "p1" };
  state.medicalCase = { id: "case1" };
  state.patientWhere = [];
  state.caseWhere = [];
});

describe("AP-03: the booking kernel checks what the client sent", () => {
  it("a patient of another clinic: refused", async () => {
    state.patient = null;
    expect(await bookAppointment(input({ patientId: "p_other" }))).toEqual({
      ok: false,
      reason: "patient_not_found",
    });
    expect(state.patientWhere[0]).toEqual({ id: "p_other", clinicId: "c1" });
  });

  it("a case that is not this patient's (or not this clinic's): refused", async () => {
    state.medicalCase = null;
    expect(await bookAppointment(input({ medicalCaseId: "case_of_other" }))).toEqual({
      ok: false,
      reason: "case_not_found",
    });
    expect(state.caseWhere[0]).toEqual({ id: "case_of_other", clinicId: "c1", patientId: "p1" });
  });

  it("no case asked for: no case lookup", async () => {
    state.patient = null; // stop right after the patient check
    await bookAppointment(input());
    expect(state.caseWhere).toEqual([]);
  });
});

describe("AP-03: POST /api/crm/appointments", () => {
  const body = {
    patientId: "p1",
    doctorId: "doc_1",
    date: "2026-10-05T00:00:00.000Z",
    time: "10:00",
    channel: "PHONE",
  };

  it("a foreign case: 422", async () => {
    state.medicalCase = null;
    const { POST } = await import("@/app/api/crm/appointments/route");
    const res = await POST(post({ ...body, medicalCaseId: "case_of_other" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "case_not_found" });
  });

  it("a foreign patient: 422", async () => {
    state.patient = null;
    const { POST } = await import("@/app/api/crm/appointments/route");
    const res = await POST(post({ ...body, patientId: "p_other" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "patient_not_found" });
  });

  it("a doctor typing a price at booking: 403 (his dialog never sends one)", async () => {
    state.role = "DOCTOR";
    const { POST } = await import("@/app/api/crm/appointments/route");
    const res = await POST(post({ ...body, priceFinal: 0 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "role_cannot_edit_price" });
    expect(state.patientWhere).toEqual([]);
    const dialog = readFileSync(
      path.join(process.cwd(), "src/components/appointments/NewAppointmentDialog.tsx"),
      "utf8",
    );
    const submit = dialog.slice(dialog.indexOf("const body = {"));
    expect(submit.slice(0, submit.indexOf("};"))).not.toMatch(
      /priceFinal|discountPct|discountAmount|priceOverride/,
    );
  });
});

describe("G6-02: a booking from the Telegram chat is a Telegram booking", () => {
  it("TG chat → TELEGRAM; anything else keeps the dialog default", () => {
    expect(bookingChannelForConversation("TG")).toBe("TELEGRAM");
    expect(bookingChannelForConversation("CALL")).toBeUndefined();
    expect(bookingChannelForConversation(null)).toBeUndefined();
  });

  it("the chat rail (and the composer's quick action, which opens the same dialog) passes it", () => {
    const rail = readFileSync(
      path.join(process.cwd(), "src/app/[locale]/crm/telegram/_components/chat-right-rail.tsx"),
      "utf8",
    );
    expect(rail).toContain("initialChannel={bookingChannelForConversation(conversation.channel)}");
    expect(rail).toContain("useOpenAppointment(conversation.id, () => setDialogOpen(true))");
  });

  it("TELEGRAM is not an auto-confirm channel: the visit waits for the patient's confirmation", () => {
    const route = readFileSync(
      path.join(process.cwd(), "src/app/api/crm/appointments/route.ts"),
      "utf8",
    );
    expect(route).toContain('const AUTO_CONFIRM_CHANNELS = new Set<string>(["PHONE", "KIOSK"]);');
  });
});
