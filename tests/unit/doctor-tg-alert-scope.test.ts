/**
 * Audit DC-04 — the doctor's cabinet rang for every Telegram message of the
 * clinic and showed its preview («Мадина: опять приступ…», another doctor's
 * patient) during a visit; «Открыть» then landed on an inbox with nothing
 * selected.
 *
 * Pinned:
 *   1. The alert asks the server whether the thread is the doctor's and
 *      rings only on a clear yes; no id, an error or a no stay silent.
 *   2. The server answers by the inbox's own rule, doctorConversationScope.
 *   3. The cabinet mounts the alert in the doctor's scope, and the doctor's
 *      inbox reads `?conv=`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { isDoctorThread } from "@/lib/doctor-tg-alert";

const state = {
  doctor: { id: "doc_1" } as { id: string } | null,
  conversation: null as { id: string } | null,
  conversationWhere: null as Record<string, unknown> | null,
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_doc_1",
    role: "DOCTOR" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: { findFirst: vi.fn(async () => state.doctor) },
    conversation: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        state.conversationWhere = where;
        return state.conversation;
      }),
    },
  },
}));

beforeEach(() => {
  state.doctor = { id: "doc_1" };
  state.conversation = null;
  state.conversationWhere = null;
});

function answer(body: unknown, status = 200) {
  return vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
}

describe("the alert asks before it rings", () => {
  it("rings for the doctor's own thread", async () => {
    const f = answer({ inScope: true });
    expect(await isDoctorThread("cv_1", f as never)).toBe(true);
    expect(f).toHaveBeenCalledWith(
      "/api/crm/doctors/me/conversations/cv_1/scope",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("stays silent for another doctor's thread", async () => {
    expect(await isDoctorThread("cv_2", answer({ inScope: false }) as never)).toBe(false);
  });

  it("stays silent when it cannot tell", async () => {
    const f = answer({ inScope: true });
    expect(await isDoctorThread(undefined, f as never)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(await isDoctorThread("cv_1", answer({ error: "x" }, 500) as never)).toBe(false);
    const broken = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await isDoctorThread("cv_1", broken as never)).toBe(false);
  });
});

describe("GET /api/crm/doctors/me/conversations/[id]/scope", () => {
  async function ask(id: string) {
    const { GET } = await import(
      "@/app/api/crm/doctors/me/conversations/[id]/scope/route"
    );
    const res = await GET(
      new Request(`https://x/api/crm/doctors/me/conversations/${id}/scope`),
    );
    return (await res.json()) as { inScope: boolean };
  }

  it("answers by the inbox's own scope", async () => {
    state.conversation = { id: "cv_1" };
    expect(await ask("cv_1")).toEqual({ inScope: true });
    const where = state.conversationWhere as { id: string; AND: { OR: unknown[] }[] };
    expect(where.id).toBe("cv_1");
    expect(where.AND[0]!.OR).toEqual([
      { appointment: { doctorId: "doc_1" } },
      { patient: { appointments: { some: { doctorId: "doc_1" } } } },
      { patientId: null },
      { assignedToId: "u_doc_1" },
    ]);
  });

  it("says no for a thread outside it", async () => {
    expect(await ask("cv_other")).toEqual({ inScope: false });
  });

  it("says no for a user with no doctor profile", async () => {
    state.doctor = null;
    state.conversation = { id: "cv_1" };
    expect(await ask("cv_1")).toEqual({ inScope: false });
  });
});

describe("the cabinet wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("mounts the alert in the doctor's scope", () => {
    expect(read("src/app/[locale]/doctor/layout.tsx")).toContain(
      '<GlobalTgAlerts inboxPath="/doctor/messages" scope="doctor" />',
    );
  });

  it("selects the thread «Открыть» names", () => {
    expect(read("src/app/[locale]/doctor/messages/_hooks/messages-context.tsx")).toMatch(
      /searchParams\.get\("conv"\)/,
    );
  });
});
