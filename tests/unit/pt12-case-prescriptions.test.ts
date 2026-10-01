/**
 * Audit PT-12 — the case card's prescriptions:
 *   - «9:00» was silently dropped («08:00, 9:00» reminded at 08:00 only) and
 *     «25:99» went through;
 *   - any doctor could change or delete a colleague's prescription, which
 *     then went out under the colleague's name;
 *   - the form made a doctor pick an author the server ignored.
 *
 * Pinned:
 *   1. Times parse with or without the leading zero, out-of-range values are
 *      named, the server schema refuses them too.
 *   2. PATCH / DELETE by a doctor who is not the author: 403 `not_author`;
 *      the author and an admin go through.
 *   3. The author picker is for an admin only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseTimesInput } from "@/lib/patient-experience/medication-schedule";
import { PrescriptionScheduleSchema } from "@/server/schemas/prescription";

const state = vi.hoisted(() => ({
  role: "DOCTOR" as "DOCTOR" | "ADMIN",
  userId: "u_doc_b",
  rx: null as Record<string, unknown> | null,
  doctorByUser: {} as Record<string, string>,
  updated: 0,
  deleted: 0,
}));

vi.mock("@/lib/api-handler", () => {
  const handler =
    (
      opts: { bodySchema?: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } },
      fn: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const parsed =
        request.method === "DELETE" ? undefined : opts.bodySchema?.safeParse(await request.json());
      if (parsed && !parsed.success) return Response.json({ error: "Validation" }, { status: 400 });
      return fn({
        request,
        body: parsed?.data,
        ctx: { kind: "TENANT", clinicId: "c1", userId: state.userId, role: state.role },
      });
    };
  return { createApiHandler: handler, createApiListHandler: handler };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/prescription/cipher-fields", () => ({
  serializePrescriptionForWrite: <T,>(v: T) => v,
  hydratePrescriptionForRead: <T,>(v: T) => v,
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    prescription: {
      update: vi.fn(async () => {
        state.updated += 1;
        return { ...state.rx, doctor: null };
      }),
      delete: vi.fn(async () => {
        state.deleted += 1;
        return state.rx;
      }),
    },
  };
  return {
    prisma: {
      prescription: { findUnique: vi.fn(async () => state.rx) },
      doctor: {
        findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
          state.doctorByUser[where.userId]
            ? { id: state.doctorByUser[where.userId] }
            : null,
        ),
      },
      $transaction: vi.fn(async <T,>(fn: (t: unknown) => Promise<T>) => fn(tx)),
    },
  };
});

beforeEach(() => {
  state.role = "DOCTOR";
  state.userId = "u_doc_b";
  state.doctorByUser = { u_doc_a: "doc_A", u_doc_b: "doc_B" };
  state.rx = {
    id: "rx_1",
    caseId: "case_1",
    patientId: "p1",
    doctorId: "doc_A",
    drugName: "Карбамазепин",
    dosage: "200 мг",
    schedule: { times: ["09:00"], days: 30 },
    notes: null,
    status: "ACTIVE",
    remindersEnabled: true,
  };
  state.updated = 0;
  state.deleted = 0;
});

async function call(method: "PATCH" | "DELETE") {
  const mod = await import(
    "@/app/api/crm/cases/[id]/prescriptions/[prescriptionId]/route"
  );
  const req = new Request("https://x/api/crm/cases/case_1/prescriptions/rx_1", {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "PATCH" ? { body: JSON.stringify({ dosage: "400 мг" }) } : {}),
  });
  return method === "PATCH" ? mod.PATCH(req) : mod.DELETE(req);
}

describe("PT-12: reminder times as people type them", () => {
  it("«9:00, 21:00» is 09:00 and 21:00", () => {
    expect(parseTimesInput("9:00, 21:00")).toEqual({
      times: ["09:00", "21:00"],
      invalid: [],
    });
  });

  it("«08:00, 9:00» keeps both, sorted, without repeats", () => {
    expect(parseTimesInput("9:00; 08:00 09:00").times).toEqual(["08:00", "09:00"]);
    expect(parseTimesInput("9.30").times).toEqual(["09:30"]);
  });

  it("«25:99» and words are named, not dropped", () => {
    expect(parseTimesInput("25:99, 09:00, утром")).toEqual({
      times: ["09:00"],
      invalid: ["25:99", "утром"],
    });
  });

  it("the server refuses a time out of range", () => {
    expect(PrescriptionScheduleSchema.safeParse({ times: ["25:99"] }).success).toBe(false);
    expect(PrescriptionScheduleSchema.safeParse({ times: ["24:00"] }).success).toBe(false);
    expect(PrescriptionScheduleSchema.safeParse({ times: ["09:00", "23:59"] }).success).toBe(
      true,
    );
  });
});

describe("PT-12: a doctor changes only his own prescription", () => {
  it.each(["PATCH", "DELETE"] as const)("%s by another doctor: 403 not_author", async (m) => {
    const res = await call(m);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reason: string }).reason).toBe("not_author");
    expect(state.updated + state.deleted).toBe(0);
  });

  it.each(["PATCH", "DELETE"] as const)("%s by the author goes through", async (m) => {
    state.userId = "u_doc_a";
    const res = await call(m);
    expect(res.status).toBe(200);
    expect(state.updated + state.deleted).toBe(1);
  });

  it.each(["PATCH", "DELETE"] as const)("%s by an admin goes through", async (m) => {
    state.role = "ADMIN";
    state.userId = "u_admin";
    const res = await call(m);
    expect(res.status).toBe(200);
  });
});

describe("PT-12: the author picker is an admin's", () => {
  it("is hidden for a doctor, and his POST names no author", () => {
    const card = readFileSync(
      join(process.cwd(), "src/app/[locale]/crm/cases/[id]/_components/prescriptions-card.tsx"),
      "utf8",
    );
    expect(card).toContain("{!form.id && canChooseAuthor && (");
    expect(card).toContain("...(canChooseAuthor ? { doctorId: input.doctorId } : {})");
    expect(card).toContain('t("validation.timesInvalid"');
    const page = readFileSync(
      join(process.cwd(), "src/app/[locale]/crm/cases/[id]/_components/case-detail-client.tsx"),
      "utf8",
    );
    expect(page).toContain('canChooseAuthor={role !== "DOCTOR"}');
  });
});
