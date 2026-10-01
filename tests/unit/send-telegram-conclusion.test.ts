/**
 * Audit VW-06: «Отправить в Telegram» right after signing sent the
 * attachments without the conclusion (the worker renders the PDF on a 30 s
 * sweep), or the PDF from before a correction, and still said «Отправлено».
 *
 * Now: while the PDF is being rendered the route sends nothing and answers
 * 409 `conclusion_rendering`; otherwise it says whether the conclusion went
 * out, and the panel shows success only when it did.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONCLUSION_BACKFILL_WINDOW_MS,
  conclusionDeliveryState,
} from "@/server/visit-notes/conclusion-delivery";

const NOW = new Date("2026-10-01T09:00:00Z");
const MIN = 60 * 1000;

const h = vi.hoisted(() => ({
  note: null as Record<string, unknown> | null,
  conclusion: null as Record<string, unknown> | null,
  attachments: [] as Array<Record<string, unknown>>,
  attachmentsWhere: null as Record<string, unknown> | null,
  sent: [] as string[],
  failSend: new Set<string>(),
  audits: [] as Array<{ action: string; meta: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_rec", role: "RECEPTIONIST", clinicId: "c1", email: "r@x.test" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT", clinicId: "c1", userId: "u_rec", role: "RECEPTIONIST" }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_r: unknown, e: { action: string; meta: Record<string, unknown> }) => {
    h.audits.push({ action: e.action, meta: e.meta });
  }),
}));
vi.mock("@/server/storage/minio", () => ({
  fetchObject: vi.fn(async () => ({
    body: new Blob(["%PDF"]).stream(),
    contentType: "application/pdf",
  })),
}));
vi.mock("@/server/telegram/send", () => ({
  sendDocument: vi.fn(
    async (_c: unknown, _chat: string, _b: unknown, o: { caption: string }) => {
      if (h.failSend.has(o.caption)) throw new Error("telegram down");
      h.sent.push(o.caption);
      return {};
    },
  ),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    visitNote: { findUnique: vi.fn(async () => h.note) },
    doctor: { findFirst: vi.fn(async () => null) },
    document: {
      findFirst: vi.fn(async () => h.conclusion),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        h.attachmentsWhere = where;
        return h.attachments;
      }),
    },
  },
}));

import { POST } from "@/app/api/crm/visit-notes/[id]/send-telegram/route";

const FILE = (name: string) =>
  `https://neurofax.uz/files/medbook/clinics/c1/documents/${name}.pdf`;

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: "vn1",
    doctorId: "doc1",
    appointmentId: "a1",
    status: "FINALIZED",
    patientHandoutMarkdown: "Принимать по схеме",
    handoutStaleAt: null,
    finalizedAt: new Date(Date.now() - 5 * MIN),
    patient: { id: "p1", fullName: "Иванов Иван", telegramId: "777" },
    clinic: { id: "c1", slug: "neurofax", tgBotToken: "T", tgBotUsername: "bot" },
    visitPrescriptions: [],
    ...overrides,
  };
}

const send = () =>
  POST(new Request("https://x/api/crm/visit-notes/vn1/send-telegram", { method: "POST" }));

beforeEach(() => {
  h.note = note();
  h.conclusion = {
    id: "d_concl",
    title: "Заключение от 01.10.2026",
    fileUrl: "https://neurofax.uz/files/medbook/clinics/c1/conclusions/vn1/r1-1.pdf",
    mimeType: "application/pdf",
  };
  h.attachments = [
    { id: "d_mri", title: "МРТ", fileUrl: FILE("mri"), mimeType: "application/pdf" },
  ];
  h.attachmentsWhere = null;
  h.sent = [];
  h.failSend = new Set();
  h.audits = [];
});

describe("conclusionDeliveryState", () => {
  const base = {
    status: "FINALIZED",
    patientHandoutMarkdown: "Текст памятки",
    handoutStaleAt: null,
    finalizedAt: new Date(NOW.getTime() - 10 * MIN),
    hasConclusionDocument: true,
    now: NOW,
  };

  it("ready only when the stored PDF is current", () => {
    expect(conclusionDeliveryState(base)).toBe("ready");
  });

  it("right after signing, before the first render: rendering", () => {
    expect(
      conclusionDeliveryState({
        ...base,
        hasConclusionDocument: false,
        finalizedAt: new Date(NOW.getTime() - 20 * 1000),
      }),
    ).toBe("rendering");
  });

  it("after a correction the old PDF is stale: rendering", () => {
    expect(conclusionDeliveryState({ ...base, handoutStaleAt: NOW })).toBe("rendering");
  });

  it("a draft or a rolled-back visit has no conclusion to give", () => {
    expect(conclusionDeliveryState({ ...base, status: "DRAFT" })).toBe("not_signed");
  });

  it("an empty handout, or a visit older than the first-render window, never gets one", () => {
    expect(conclusionDeliveryState({ ...base, patientHandoutMarkdown: "  " })).toBe("missing");
    expect(
      conclusionDeliveryState({
        ...base,
        hasConclusionDocument: false,
        finalizedAt: new Date(NOW.getTime() - CONCLUSION_BACKFILL_WINDOW_MS - MIN),
      }),
    ).toBe("missing");
  });
});

describe("POST /api/crm/visit-notes/[id]/send-telegram (VW-06)", () => {
  it("sends the conclusion first and says it was included", async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sent: 2,
      failed: 0,
      conclusionIncluded: true,
      conclusion: "included",
    });
    expect(h.sent).toEqual(["Заключение от 01.10.2026", "МРТ"]);
    // The conclusion has its own lookup: attachments never repeat it.
    expect(h.attachmentsWhere).toMatchObject({
      visitNoteId: null,
      type: { not: "CONCLUSION" },
      // CD-09: a document ADMIN voided is never sent.
      voidedAt: null,
    });
  });

  it("within 30 s of signing: 409 conclusion_rendering and nothing is sent", async () => {
    h.conclusion = null;
    h.note = note({ finalizedAt: new Date(Date.now() - 10 * 1000) });
    const res = await send();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "conclusion_rendering" });
    expect(h.sent).toEqual([]);
  });

  it("after an in-window correction the stale PDF is not sent", async () => {
    h.note = note({ handoutStaleAt: new Date() });
    const res = await send();
    expect(res.status).toBe(409);
    expect(h.sent).toEqual([]);
  });

  it("a draft sends attachments only, never a PDF left from before a rollback", async () => {
    h.note = note({ status: "DRAFT" });
    const res = await send();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sent: 1,
      conclusionIncluded: false,
      conclusion: "not_signed",
    });
    expect(h.sent).toEqual(["МРТ"]);
  });

  it("a conclusion that failed to send is reported, not hidden in a count", async () => {
    h.failSend.add("Заключение от 01.10.2026");
    const res = await send();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sent: 1,
      failed: 1,
      conclusionIncluded: false,
      conclusion: "failed",
    });
    expect(h.audits[0]?.meta).toMatchObject({ conclusion: "failed" });
  });

  it("nothing to send at all is still nothing_to_send", async () => {
    h.note = note({ status: "DRAFT" });
    h.attachments = [];
    const res = await send();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "nothing_to_send", conclusion: "not_signed" });
  });
});

describe("the panel (VW-06)", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../src/app/[locale]/doctor/_components/telegram-send-panel.tsx"),
    "utf8",
  );

  it("shows success only when the conclusion went out", () => {
    const onSuccess = src.slice(src.indexOf("onSuccess:"), src.indexOf("onError:"));
    expect(onSuccess).toMatch(/if \(r\.conclusionIncluded\) \{\s*toast\.success/);
    expect(onSuccess).toMatch(/toast\.warning\(/);
    expect(src).toContain('e.reason === "conclusion_rendering"');
  });

  it("before signing, the button says it sends files only", () => {
    expect(src).toContain('signed === false ? t("sendFiles") : t("send")');
  });
});
