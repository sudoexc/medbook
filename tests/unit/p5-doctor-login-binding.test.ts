/**
 * Audit ST-04: a doctor login and its schedule card stay in step.
 *
 *   - deactivating through «Редактировать» (PATCH active=false) or moving the
 *     doctor to another role releases the card, like DELETE did, so it is
 *     back in «врачи без логина»;
 *   - reactivating a doctor, or promoting someone to DOCTOR, needs a card;
 *   - nobody deactivates their own account through PATCH either;
 *   - a doctor login without a card gets an explanation page instead of the
 *     /doctor ⇄ /crm redirect loop.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  card: null as null | { id: string },
  doctors: {} as Record<string, { id: string; userId: string | null }>,
  userUpdates: [] as Array<Record<string, unknown>>,
  released: [] as unknown[],
  bound: [] as Array<{ id: string; userId: string }>,
  revoke: vi.fn(async () => 1),
  existingByEmail: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "admin1", role: "ADMIN" };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx,
        }),
    createApiListHandler: () => async () => new Response(null),
  };
});
vi.mock("@/lib/prisma", () => {
  const tx = {
    user: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.userUpdates.push(data);
        return { ...h.user, ...data };
      }),
    },
    doctor: {
      updateMany: vi.fn(async ({ where }: { where: unknown }) => {
        h.released.push(where);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { userId: string } }) => {
        h.bound.push({ id: where.id, userId: data.userId });
        return {};
      }),
    },
  };
  return {
    prisma: {
      user: {
        findFirst: vi.fn(async () => h.user),
        findUnique: vi.fn(async () => h.existingByEmail),
        // The address check ignores case (audit ST-15).
        findMany: vi.fn(async () => (h.existingByEmail ? [h.existingByEmail] : [])),
        count: vi.fn(async () => 1),
      },
      doctor: {
        findFirst: vi.fn(async ({ where }: { where: { id?: string; userId?: string } }) => {
          if (where.userId) return h.card;
          return where.id ? (h.doctors[where.id] ?? null) : null;
        }),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/auth/session-guard", () => ({
  revokeUserSessions: h.revoke,
  invalidateSessionGuardCache: vi.fn(),
}));

import { planDoctorBinding } from "@/server/users/staff-user";
import { PATCH } from "@/app/api/crm/users/[id]/route";
import { POST as createUser } from "@/app/api/crm/users/route";

function patch(id: string, body: Record<string, unknown>) {
  return PATCH(
    new Request(`https://x/api/crm/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  h.user = { id: "doc1", clinicId: "c1", role: "DOCTOR", active: true, email: "d@x.uz" };
  h.card = { id: "card1" };
  h.doctors = {
    card1: { id: "card1", userId: "doc1" },
    card2: { id: "card2", userId: null },
    taken: { id: "taken", userId: "someone" },
  };
  h.userUpdates = [];
  h.released = [];
  h.bound = [];
  h.revoke.mockClear();
  h.existingByEmail = null;
});

describe("planDoctorBinding", () => {
  it("an account that is not an active DOCTOR holds no card", () => {
    expect(
      planDoctorBinding({ nextRole: "DOCTOR", nextActive: false, currentCardId: "c", requestedCardId: null }),
    ).toEqual({ ok: true, unlinkCardId: "c", linkCardId: null });
    expect(
      planDoctorBinding({ nextRole: "RECEPTIONIST", nextActive: true, currentCardId: "c", requestedCardId: null }),
    ).toEqual({ ok: true, unlinkCardId: "c", linkCardId: null });
  });

  it("an active DOCTOR keeps its card, switches to a requested one, or must get one", () => {
    expect(
      planDoctorBinding({ nextRole: "DOCTOR", nextActive: true, currentCardId: "c", requestedCardId: null }),
    ).toEqual({ ok: true, unlinkCardId: null, linkCardId: null });
    expect(
      planDoctorBinding({ nextRole: "DOCTOR", nextActive: true, currentCardId: "c", requestedCardId: "d" }),
    ).toEqual({ ok: true, unlinkCardId: "c", linkCardId: "d" });
    expect(
      planDoctorBinding({ nextRole: "DOCTOR", nextActive: true, currentCardId: null, requestedCardId: null }),
    ).toEqual({ ok: false, reason: "doctor_id_required" });
  });
});

describe("PATCH /api/crm/users/[id]", () => {
  it("deactivating through the edit dialog releases the card and the sessions", async () => {
    const r = await patch("doc1", { active: false });
    expect(r.status).toBe(200);
    expect(h.released).toEqual([{ id: "card1", userId: "doc1" }]);
    expect(h.revoke).toHaveBeenCalledWith("doc1");
  });

  it("moving a doctor to reception releases the card", async () => {
    const r = await patch("doc1", { role: "RECEPTIONIST" });
    expect(r.status).toBe(200);
    expect(h.released).toEqual([{ id: "card1", userId: "doc1" }]);
    expect(h.bound).toEqual([]);
  });

  it("reactivating a doctor without a card asks for one", async () => {
    h.user = { ...h.user, active: false };
    h.card = null;
    const r = await patch("doc1", { active: true });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ reason: "doctor_id_required" });
    expect(h.userUpdates).toHaveLength(0);
  });

  it("reactivating with a free card binds it", async () => {
    h.user = { ...h.user, active: false };
    h.card = null;
    const r = await patch("doc1", { active: true, doctorId: "card2" });
    expect(r.status).toBe(200);
    expect(h.userUpdates[0]).toMatchObject({ active: true });
    expect(h.bound).toEqual([{ id: "card2", userId: "doc1" }]);
  });

  it("a card held by someone else is refused", async () => {
    h.card = null;
    const r = await patch("doc1", { doctorId: "taken" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ reason: "doctor_taken" });
  });

  it("an active doctor may be moved to another card", async () => {
    const r = await patch("doc1", { doctorId: "card2" });
    expect(r.status).toBe(200);
    expect(h.released).toEqual([{ id: "card1", userId: "doc1" }]);
    expect(h.bound).toEqual([{ id: "card2", userId: "doc1" }]);
  });

  it("nobody deactivates their own account here", async () => {
    h.user = { id: "admin1", clinicId: "c1", role: "RECEPTIONIST", active: true };
    h.card = null;
    const r = await patch("admin1", { active: false });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ reason: "cannot_deactivate_self" });
  });

  it("an edit that keeps the doctor active leaves the card alone", async () => {
    const r = await patch("doc1", { name: "Султанов Азиз" });
    expect(r.status).toBe(200);
    expect(h.released).toEqual([]);
    expect(h.bound).toEqual([]);
  });
});

describe("POST /api/crm/users with the email of a deactivated colleague", () => {
  it("says the account exists and is switched off, so the admin reactivates it", async () => {
    h.existingByEmail = { id: "doc1", email: "d@x.uz", clinicId: "c1", active: false };
    const res = await createUser(
      new Request("https://x/api/crm/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "d@x.uz", name: "Азиз", role: "RECEPTIONIST" }),
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "email_taken_inactive" });
  });
});
