/**
 * Audit MA-18 — the relative's mode in the Mini App.
 *
 * In «Мама» the owner could not cancel or move her visit (PATCH and DELETE
 * looked the visit up under HIS card: 404), the case pick after her booking
 * 404'd, and labs and documents returned HIS results under her name. Every
 * per-visit route and both lists now act for `onBehalfOf` after the family
 * check (`resolveActivePatient`, real here): her data opens only for her
 * family owner, and an unlinked id is 403.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  apptWhere: [] as Array<Record<string, unknown>>,
  labsWhere: null as Record<string, unknown> | null,
  docsWhere: null as Record<string, unknown> | null,
  docFindWhere: null as Record<string, unknown> | null,
  cancelInput: null as Record<string, unknown> | null,
  rescheduleInput: null as Record<string, unknown> | null,
  lockedFor: null as string | null,
  caseCreate: null as Record<string, unknown> | null,
}));

const CTX = {
  clinicId: "c1",
  clinicSlug: "neurofax",
  patientId: "p_owner",
  patient: { id: "p_owner", fullName: "Karimov Aziz", preferredLang: "RU" },
};

vi.mock("@/server/miniapp/handler", () => {
  const wrap =
    (
      opts: { bodySchema?: { parse: (v: unknown) => unknown } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const body = opts?.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined;
      return handler({ request, body, ctx: CTX });
    };
  return {
    createMiniAppHandler: wrap,
    createMiniAppListHandler: wrap,
    resolveMiniAppContext: vi.fn(async () => ({ ok: true, ctx: CTX })),
    resolveMiniAppLink: vi.fn(),
  };
});

/** Mama's visit lives on her card; the owner's own card has none. */
const MAMA_VISIT = { id: "apt_mama", patientId: "p_mama" };

vi.mock("@/lib/prisma", () => {
  const prisma = {
    patientFamily: {
      findFirst: vi.fn(async ({ where }: { where: { ownerPatientId: string; linkedPatientId: string } }) =>
        where.ownerPatientId === "p_owner" && where.linkedPatientId === "p_mama"
          ? { linkedPatient: { id: "p_mama", preferredLang: "UZ" } }
          : null,
      ),
    },
    appointment: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; patientId: string } }) => {
        state.apptWhere.push(where);
        return where.id === MAMA_VISIT.id && where.patientId === MAMA_VISIT.patientId
          ? {
              id: "apt_mama",
              doctorId: "d1",
              date: new Date("2026-10-05T05:00:00Z"),
              medicalCaseId: null,
              status: "BOOKED",
              channel: "TELEGRAM",
              payments: [],
            }
          : null;
      }),
    },
    labResult: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        state.labsWhere = where;
        return [];
      }),
    },
    document: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        state.docsWhere = where;
        return [
          {
            id: "doc_mama",
            type: "CONCLUSION",
            title: "Xulosa",
            fileUrl: "x",
            mimeType: "application/pdf",
            sizeBytes: 1,
            createdAt: new Date(),
          },
        ];
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        state.docFindWhere = where;
        return null;
      }),
    },
    medicalCase: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.caseCreate = data;
        return { id: "case_new", title: data.title };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});

vi.mock("@/server/appointments/cancel", () => ({
  cancelAppointment: vi.fn(async (input: Record<string, unknown>) => {
    state.cancelInput = input;
    return { ok: true, appointment: { id: "apt_mama", status: "CANCELLED" } };
  }),
}));
vi.mock("@/server/appointments/patient-reschedule", () => ({
  reschedulePatientAppointment: vi.fn(async (input: Record<string, unknown>) => {
    state.rescheduleInput = input;
    return { ok: true, moved: true, appointment: { id: "apt_mama", status: "BOOKED" } };
  }),
}));
vi.mock("@/server/cases/attach", () => ({
  lockPatientCases: vi.fn(async (_tx: unknown, patientId: string) => {
    state.lockedFor = patientId;
  }),
  attachAppointmentToCase: vi.fn(async () => []),
  auditFreeRepeats: vi.fn(),
  miniAppAttachRefusal: vi.fn(() => null),
  MINIAPP_ATTACH_PAYMENT_FILTER: { status: { not: "UNPAID" } },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/server/storage/minio", () => ({ uploadObject: vi.fn(), fetchObject: vi.fn() }));

import { DELETE, PATCH } from "@/app/api/miniapp/appointments/[id]/route";
import { POST as attachCase } from "@/app/api/miniapp/appointments/[id]/attach-case/route";
import { GET as labs } from "@/app/api/miniapp/labs/route";
import { GET as documents } from "@/app/api/miniapp/documents/route";
import { GET as documentFile } from "@/app/api/miniapp/documents/[id]/file/route";

const base = "http://x/api/miniapp";

beforeEach(() => {
  process.env.APP_SECRET = "test-app-secret";
  state.apptWhere = [];
  state.labsWhere = null;
  state.docsWhere = null;
  state.docFindWhere = null;
  state.cancelInput = null;
  state.rescheduleInput = null;
  state.lockedFor = null;
  state.caseCreate = null;
});

describe("cancel and move a relative's visit", () => {
  it("DELETE ?onBehalfOf finds her visit and cancels it as the owner acting for her", async () => {
    const res = await DELETE(
      new Request(`${base}/appointments/apt_mama?clinicSlug=neurofax&onBehalfOf=p_mama`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
    expect(state.apptWhere[0]).toMatchObject({ id: "apt_mama", clinicId: "c1", patientId: "p_mama" });
    expect(state.cancelInput).toMatchObject({
      appointmentId: "apt_mama",
      actorRole: "PATIENT",
      actorPatientId: "p_owner",
      actorOnBehalfOfPatientId: "p_mama",
    });
  });

  it("PATCH ?onBehalfOf moves her visit", async () => {
    const res = await PATCH(
      new Request(`${base}/appointments/apt_mama?clinicSlug=neurofax&onBehalfOf=p_mama`, {
        method: "PATCH",
        body: JSON.stringify({ startAt: "2026-10-05T06:00:00.000Z" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.rescheduleInput).toMatchObject({
      appointmentId: "apt_mama",
      patientId: "p_mama",
      actor: { patientId: "p_owner", onBehalfOfPatientId: "p_mama" },
    });
  });

  it("PATCH cancel with the relative in the body (older clients) works too", async () => {
    const res = await PATCH(
      new Request(`${base}/appointments/apt_mama?clinicSlug=neurofax`, {
        method: "PATCH",
        body: JSON.stringify({ cancel: true, onBehalfOf: "p_mama" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.cancelInput).toMatchObject({ actorOnBehalfOfPatientId: "p_mama" });
  });

  it("without the context her visit is not the owner's: 404, nothing cancelled", async () => {
    const res = await DELETE(
      new Request(`${base}/appointments/apt_mama?clinicSlug=neurofax`, { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
    expect(state.cancelInput).toBeNull();
  });

  it("a patient who is not linked to the owner is 403", async () => {
    const res = await DELETE(
      new Request(`${base}/appointments/apt_mama?clinicSlug=neurofax&onBehalfOf=p_stranger`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(403);
    expect(state.cancelInput).toBeNull();
  });
});

describe("case pick after a relative's booking", () => {
  it("files her visit under a new case of hers", async () => {
    const res = await attachCase(
      new Request(`${base}/appointments/apt_mama/attach-case?clinicSlug=neurofax&onBehalfOf=p_mama`, {
        method: "POST",
        body: JSON.stringify({ create: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.lockedFor).toBe("p_mama");
    expect(state.caseCreate).toMatchObject({ patientId: "p_mama", clinicId: "c1" });
    // Her card is in Uzbek, so is the case title.
    expect(String(state.caseCreate!.title)).toMatch(/^Yangi shikoyat/);
  });

  it("an unlinked relative is 403", async () => {
    const res = await attachCase(
      new Request(`${base}/appointments/apt_mama/attach-case?clinicSlug=neurofax&onBehalfOf=p_x`, {
        method: "POST",
        body: JSON.stringify({ create: true }),
      }),
    );
    expect(res.status).toBe(403);
    expect(state.caseCreate).toBeNull();
  });
});

describe("labs and documents in her context", () => {
  it("labs are hers, never the owner's", async () => {
    const res = await labs(new Request(`${base}/labs?clinicSlug=neurofax&onBehalfOf=p_mama`));
    expect(res.status).toBe(200);
    expect(state.labsWhere).toMatchObject({ clinicId: "c1", patientId: "p_mama", status: "REVIEWED" });
  });

  it("labs for an unlinked patient are 403", async () => {
    const res = await labs(new Request(`${base}/labs?clinicSlug=neurofax&onBehalfOf=p_x`));
    expect(res.status).toBe(403);
    expect(state.labsWhere).toBeNull();
  });

  it("documents are hers, and their links open for her card", async () => {
    const res = await documents(new Request(`${base}/documents?clinicSlug=neurofax&onBehalfOf=p_mama`));
    expect(res.status).toBe(200);
    expect(state.docsWhere).toMatchObject({ clinicId: "c1", patientId: "p_mama" });
    const body = (await res.json()) as { documents: Array<{ fileUrl: string }> };
    const t = new URL(body.documents[0]!.fileUrl, "http://x").searchParams.get("t")!;
    const claims = JSON.parse(Buffer.from(t.split(".")[0]!, "base64url").toString("utf8")) as {
      p: string;
    };
    expect(claims.p).toBe("p_mama");
  });

  it("the owner's own lists stay his", async () => {
    await labs(new Request(`${base}/labs?clinicSlug=neurofax`));
    expect(state.labsWhere).toMatchObject({ patientId: "p_owner" });
    await documents(new Request(`${base}/documents?clinicSlug=neurofax`));
    expect(state.docsWhere).toMatchObject({ patientId: "p_owner" });
  });

  it("a document opened with the header looks under her card in her context", async () => {
    const res = await documentFile(
      new Request(`${base}/documents/doc_mama/file?clinicSlug=neurofax&onBehalfOf=p_mama`),
      { params: Promise.resolve({ id: "doc_mama" }) },
    );
    expect(res.status).toBe(404);
    expect(state.docFindWhere).toMatchObject({ id: "doc_mama", clinicId: "c1", patientId: "p_mama" });
  });
});
