/**
 * Audit LD-08: «Показывать на сайте» on the doctor's card.
 *
 *   - the edit form sends `listedOnSite` only when the switch moved;
 *   - an admin's PATCH stores it and drops the cached price sheet (a line
 *     naming the doctor leaves the landing at once);
 *   - a doctor cannot put himself on or off the site: the route is the
 *     admin's (audit DR-16), so his PATCH is refused outright.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "ADMIN" as string,
  userId: "admin1",
  before: null as null | Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  invalidated: 0,
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/site-prices", () => ({
  invalidateSitePrices: vi.fn(() => {
    h.invalidated += 1;
  }),
}));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/lib/api-handler", () => {
  const ctx = () => ({ kind: "TENANT", clinicId: "c1", userId: h.userId, role: h.role });
  return {
    createApiHandler:
      (
        opts: { roles?: string[]; bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) => {
        // Same role gate as the real createApiHandler.
        if (opts.roles && !opts.roles.includes(h.role)) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        return handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx: ctx(),
        });
      },
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx: ctx() }),
  };
});
vi.mock("@/lib/prisma", () => {
  const doctor = {
    findUnique: vi.fn(async () => h.before),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      h.updates.push(data);
      return { ...h.before, ...data };
    }),
  };
  return {
    prisma: {
      doctor,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ doctor })),
    },
  };
});

import { PATCH } from "@/app/api/crm/doctors/[id]/route";
import {
  buildDoctorPatch,
  formFromDoctor,
} from "@/app/[locale]/crm/doctors/[id]/_components/edit-doctor-form";
import type { DoctorDetail } from "@/app/[locale]/crm/doctors/[id]/_hooks/use-doctor";

const patch = (body: unknown) =>
  PATCH(
    new Request("https://x/api/crm/doctors/d1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  h.role = "ADMIN";
  h.userId = "admin1";
  h.before = { id: "d1", clinicId: "c1", userId: "u_doc", isActive: false, listedOnSite: true, cabinetId: "cab1" };
  h.updates = [];
  h.invalidated = 0;
});

describe("PATCH /api/crm/doctors/[id] listedOnSite", () => {
  it("an admin takes a doctor who left off the site, and the price sheet is dropped", async () => {
    const res = await patch({ listedOnSite: false });
    expect(res.status).toBe(200);
    expect(h.updates).toEqual([{ listedOnSite: false }]);
    expect(h.invalidated).toBe(1);
  });

  it("other edits leave the price sheet cache alone", async () => {
    await patch({ color: "#3B82F6" });
    expect(h.invalidated).toBe(0);
  });

  it("a doctor cannot list or unlist himself", async () => {
    h.role = "DOCTOR";
    h.userId = "u_doc";
    const res = await patch({ listedOnSite: false, color: "#3B82F6" });
    expect(res.status).toBe(403);
    expect(h.updates).toEqual([]);
    expect(h.invalidated).toBe(0);
  });
});

describe("edit doctor form", () => {
  const doctor = (over: Partial<DoctorDetail> = {}): DoctorDetail =>
    ({
      id: "d1",
      slug: "busakov",
      nameRu: "Бусаков Бахтияр",
      nameUz: "Busakov Baxtiyor",
      specializationRu: "Невролог",
      specializationUz: "Nevrolog",
      photoUrl: null,
      bioRu: null,
      bioUz: null,
      color: "#3DD5C0",
      pricePerVisit: null,
      salaryPercent: 40,
      listedOnSite: true,
      ...over,
    }) as DoctorDetail;

  it("sends nothing while the switch stays", () => {
    const d = doctor();
    expect(buildDoctorPatch(d, formFromDoctor(d))).toEqual({ ok: true, patch: {} });
  });

  it("sends listedOnSite when the switch moves", () => {
    const d = doctor();
    expect(buildDoctorPatch(d, { ...formFromDoctor(d), listedOnSite: false })).toEqual({
      ok: true,
      patch: { listedOnSite: false },
    });
    const off = doctor({ listedOnSite: false });
    expect(formFromDoctor(off).listedOnSite).toBe(false);
    expect(buildDoctorPatch(off, { ...formFromDoctor(off), listedOnSite: true })).toEqual({
      ok: true,
      patch: { listedOnSite: true },
    });
  });
});
