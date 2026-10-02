/**
 * Audit AC-23: the top-bar search returned patients with `take: 5` and no
 * order, so a common surname gave whichever five Postgres met first, and one
 * typed letter ran four ILIKE scans. Acceptance: «Каримов» lists the most
 * recently seen patients first, stably; one character sends nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  patient: [] as Array<Record<string, unknown>>,
  other: 0,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        calls.patient.push(args);
        return [];
      }),
    },
    doctor: { findMany: vi.fn(async () => (calls.other++, [])) },
    appointment: { findMany: vi.fn(async () => (calls.other++, [])) },
    conversation: { findMany: vi.fn(async () => (calls.other++, [])) },
  },
}));

vi.mock("@/lib/api-handler", () => ({
  createApiListHandler:
    (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({
        request,
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u1", role: "RECEPTIONIST" },
      }),
}));

import { GET } from "@/app/api/crm/search/route";
import { GLOBAL_SEARCH_MIN_CHARS } from "@/lib/global-search";

const search = (q: string) =>
  GET(new Request(`https://x/api/crm/search?q=${encodeURIComponent(q)}`)) as Promise<Response>;

beforeEach(() => {
  calls.patient = [];
  calls.other = 0;
});

describe("/api/crm/search (audit AC-23)", () => {
  it("answers one character with empty groups and no query", async () => {
    expect(GLOBAL_SEARCH_MIN_CHARS).toBe(2);
    const res = await search(" К ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      patients: [],
      doctors: [],
      appointments: [],
      conversations: [],
    });
    expect(calls.patient).toHaveLength(0);
    expect(calls.other).toBe(0);
  });

  it("orders patients by the last visit, never-seen cards last, with a stable tiebreak", async () => {
    await search("Каримов");
    expect(calls.patient).toHaveLength(1);
    const args = calls.patient[0]!;
    expect(args.take).toBe(5);
    expect(args.orderBy).toEqual([
      { lastVisitAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "asc" },
    ]);
    expect(calls.other).toBe(3);
  });

  it("the dialog waits for the same number of characters", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/layout/global-search.tsx"),
      "utf8",
    );
    expect(src).toMatch(/if \(q\.length < GLOBAL_SEARCH_MIN_CHARS\) \{/);
    expect(src).toMatch(/query\.trim\(\)\.length < GLOBAL_SEARCH_MIN_CHARS \?/);
  });
});
