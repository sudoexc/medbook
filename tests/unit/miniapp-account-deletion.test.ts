/**
 * Audit MA-12: «Скачать мои данные», «Удалить аккаунт» and «Отменить
 * удаление» never worked.
 *
 *   - The screens called `fetch` by hand without `?clinicSlug=`, and the
 *     Mini App handler answers 400 `missing_clinic_slug` to that. They now
 *     go through `useMiniAppFetch`, which adds it.
 *   - The «scheduled, you can cancel» state lived only in the screen's
 *     memory: GET /api/miniapp/account/delete now returns it.
 *   - A card the Mini App created has no number (a `tg:<id>` stub): the
 *     screen compared the typed number with "", the server with the stub's
 *     digits (the Telegram id). Such a card confirms with a word.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { deletionConfirmationMatches } from "@/lib/patient-experience/account-deletion";

const state = vi.hoisted(() => ({
  patient: { phone: "", phoneNormalized: "" },
  activeJob: null as { id: string; status: string; scheduledFor: Date; mode: string } | null,
  created: [] as unknown[],
}));

vi.mock("@/server/miniapp/handler", () => {
  const ctx = {
    clinicId: "c1",
    clinicSlug: "neurofax",
    patientId: "p1",
    patient: { id: "p1", fullName: "Dilnoza", preferredLang: "RU", telegramId: "555123" },
  };
  const wrap =
    (
      opts: { bodySchema?: { parse: (v: unknown) => unknown } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const body = opts?.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined;
      return handler({ request, body, ctx });
    };
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});
vi.mock("@/server/miniapp/idempotency", () => ({
  withIdempotency: (_r: Request, _s: unknown, fn: () => Promise<Response>) => fn(),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  auditMiniApp: vi.fn(async () => undefined),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: {
      findUnique: vi.fn(async () => state.patient),
      update: vi.fn(async () => ({})),
    },
    dataDeletionJob: {
      findFirst: vi.fn(async () => state.activeJob),
      create: vi.fn(async ({ data }: { data: { scheduledFor: Date } }) => {
        state.created.push(data);
        return { id: "job_new", status: "APPROVED", scheduledFor: data.scheduledFor, mode: "ANONYMIZE" };
      }),
    },
  },
}));

import { GET, POST } from "@/app/api/miniapp/account/delete/route";

function del(confirmation: string) {
  return POST(
    new Request("http://x/api/miniapp/account/delete?clinicSlug=neurofax", {
      method: "POST",
      body: JSON.stringify({ confirmation }),
    }),
  );
}

beforeEach(() => {
  state.patient = { phone: "", phoneNormalized: "" };
  state.activeJob = null;
  state.created.length = 0;
});

describe("deletionConfirmationMatches", () => {
  it("a card with a number confirms with that number, in any formatting", () => {
    const phone = "+998 90 123 45 67";
    expect(deletionConfirmationMatches({ hasPhone: true, phone, confirmation: "+998901234567" })).toBe(true);
    expect(deletionConfirmationMatches({ hasPhone: true, phone, confirmation: "998 90 123-45-67" })).toBe(true);
    expect(deletionConfirmationMatches({ hasPhone: true, phone, confirmation: "+998901234568" })).toBe(false);
    expect(deletionConfirmationMatches({ hasPhone: true, phone, confirmation: "УДАЛИТЬ" })).toBe(false);
  });

  it("a card without a number confirms with the word, in either language", () => {
    for (const word of ["УДАЛИТЬ", "удалить", " Удалить ", "O‘CHIRISH", "o'chirish", "Oʻchirish", "ochirish"]) {
      expect(deletionConfirmationMatches({ hasPhone: false, phone: "", confirmation: word }), word).toBe(true);
    }
    expect(deletionConfirmationMatches({ hasPhone: false, phone: "", confirmation: "" })).toBe(false);
    expect(deletionConfirmationMatches({ hasPhone: false, phone: "", confirmation: "удали" })).toBe(false);
  });
});

describe("POST /api/miniapp/account/delete", () => {
  it("a Telegram-only card (tg: stub) is confirmed by the word, not by its Telegram id", async () => {
    state.patient = { phone: "tg:555123", phoneNormalized: "tg:555123" };
    expect((await del("555123")).status).toBe(400);
    expect(state.created).toHaveLength(0);

    const res = await del("удалить");
    expect(res.status).toBe(200);
    expect(state.created).toHaveLength(1);
    expect(await res.json()).toMatchObject({ jobId: "job_new", reused: false });
  });

  it("a card with a real number still needs that number", async () => {
    state.patient = { phone: "+998901234567", phoneNormalized: "+998901234567" };
    expect((await del("УДАЛИТЬ")).status).toBe(400);
    expect((await del("+998 90 123 45 67")).status).toBe(200);
  });
});

describe("GET /api/miniapp/account/delete", () => {
  it("returns the scheduled request so the screen can offer to cancel it", async () => {
    state.activeJob = {
      id: "job_1",
      status: "APPROVED",
      scheduledFor: new Date("2026-12-30T05:00:00Z"),
      mode: "ANONYMIZE",
    };
    const res = await GET(new Request("http://x/api/miniapp/account/delete?clinicSlug=neurofax"));
    expect(await res.json()).toEqual({
      pending: { jobId: "job_1", scheduledFor: "2026-12-30T05:00:00.000Z" },
    });
  });

  it("returns null when nothing is scheduled", async () => {
    const res = await GET(new Request("http://x/api/miniapp/account/delete?clinicSlug=neurofax"));
    expect(await res.json()).toEqual({ pending: null });
  });
});

describe("the screens call the API through useMiniAppFetch", () => {
  const root = join(__dirname, "../../src/app/c/[slug]/my");
  it("no hand-rolled fetch to the account endpoints is left", () => {
    for (const f of ["_components/profile-screen.tsx", "_components/account-delete-screen.tsx"]) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src, f).not.toMatch(/fetch\(\s*["'`]\/api\/miniapp\/account/);
    }
    const hooks = readFileSync(join(root, "_hooks/use-account.ts"), "utf8");
    expect(hooks).toContain("useMiniAppFetch");
    expect(hooks).not.toMatch(/\bfetch\(/);
  });
});
