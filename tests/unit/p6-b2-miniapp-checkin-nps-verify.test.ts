/**
 * P6 group B2, Mini App and public verify pages:
 *
 *   MA-21  «Я на месте» is offered only while the desk has not met the
 *          patient (BOOKED / CONFIRMED). The home hero also shows a visit
 *          already WAITING or IN_PROGRESS, where the server refuses the tap
 *          and the patient got «Ошибка».
 *   MA-23  NPS is accepted for a COMPLETED visit only, and a double tap
 *          cannot write two reviews: the duplicate check runs under a
 *          per-visit advisory lock inside the insert transaction. An alert
 *          sent on behalf of a relative names the relative.
 *   MA-24  The public sick-leave (and prescription) check shows the fact of
 *          cancellation, never the doctor's free-text reason. «Действует
 *          сегодня» by the Tashkent day is pinned in
 *          print-times-clinic-zone.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appt: null as Record<string, unknown> | null,
  /** What the in-transaction duplicate check finds (the racing request's row). */
  existingInTx: null as { id: string } | null,
  onBehalfOf: false,
  calls: [] as string[],
  creates: [] as Array<Record<string, unknown>>,
  actions: [] as Array<Record<string, unknown>>,
  sickLeave: null as Record<string, unknown> | null,
  recipe: null as Record<string, unknown> | null,
}));

vi.mock("@/server/miniapp/handler", () => {
  const wrap =
    (
      _opts: unknown,
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) =>
      handler({
        request,
        body: await request
          .clone()
          .json()
          .catch(() => undefined),
        ctx: {
          clinicId: "c1",
          clinicSlug: "neurofax",
          patientId: "owner",
          patient: { id: "owner", fullName: "Owner Patient", preferredLang: "RU" },
          tgUser: { id: 1, first_name: "Owner" },
        },
      });
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () =>
    state.onBehalfOf
      ? { ok: true, patientId: "rel", isOnBehalfOf: true, preferredLang: "RU", ownerPatientId: "owner" }
      : { ok: true, patientId: "owner", isOnBehalfOf: false, preferredLang: "RU", ownerPatientId: "owner" },
  ),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => {
    state.calls.push("outbox");
    return { eventId: "ev" };
  }),
}));
vi.mock("@/server/actions/repository", () => ({
  upsertAction: vi.fn(async (_db: unknown, _clinicId: string, payload: Record<string, unknown>) => {
    state.actions.push(payload);
    return { id: "act1" };
  }),
}));
vi.mock("@/lib/audit", () => ({ auditMiniApp: vi.fn(async () => undefined) }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  runUnscoped: <T,>(_why: string, fn: () => T) => fn(),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
      state.calls.push(`lock:${strings.join("?")}`);
      return 1;
    }),
    patientReview: {
      findFirst: vi.fn(async () => {
        state.calls.push("findFirst");
        return state.existingInTx;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.calls.push("create");
        state.creates.push(data);
        return { id: "rev1", score: data.score, comment: data.comment, respondedAt: data.respondedAt };
      }),
    },
  };
  const prisma = {
    appointment: { findFirst: vi.fn(async () => state.appt) },
    clinic: { findUnique: vi.fn(async () => ({ npsAlertThreshold: 7 })) },
    patientReview: {
      findFirst: vi.fn(async () => {
        state.calls.push("findFirst:outside-tx");
        return null;
      }),
    },
    sickLeave: { findFirst: vi.fn(async () => state.sickLeave) },
    ePrescription: { findFirst: vi.fn(async () => state.recipe) },
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { prisma };
});

import { canSelfCheckIn } from "@/lib/appointments/self-check-in";
import { POST as npsPost } from "@/app/api/miniapp/nps/[appointmentId]/route";
import { GET as verifySickLeave } from "@/app/api/verify/sick-leave/[token]/route";
import { GET as verifyRecipe } from "@/app/api/verify/recipe/[token]/route";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

function appt(status: string, patientId = "owner"): Record<string, unknown> {
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId,
    date: new Date("2026-10-01T05:00:00Z"),
    status,
    completedAt: status === "COMPLETED" ? new Date("2026-10-01T06:00:00Z") : null,
    doctorId: "d1",
    doctor: { id: "d1", nameRu: "Султанов Азиз", nameUz: "Sultanov Aziz" },
    patient: { fullName: patientId === "rel" ? "Relative Patient" : "Owner Patient" },
  };
}

function submit(score: number, query = ""): Promise<Response> {
  return npsPost(
    new Request(`https://x/api/miniapp/nps/apt_1${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ score }),
    }),
  );
}

beforeEach(() => {
  state.appt = null;
  state.existingInTx = null;
  state.onBehalfOf = false;
  state.calls = [];
  state.creates = [];
  state.actions = [];
  state.sickLeave = null;
  state.recipe = null;
});

describe("MA-21: «Я на месте» only before the desk has met the patient", () => {
  it("BOOKED and CONFIRMED can check in; WAITING, IN_PROGRESS and the rest cannot", () => {
    expect(canSelfCheckIn("BOOKED")).toBe(true);
    expect(canSelfCheckIn("CONFIRMED")).toBe(true);
    for (const s of ["WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "SKIPPED"]) {
      expect(canSelfCheckIn(s)).toBe(false);
    }
  });

  it("the server route and the hero button read the same rule", () => {
    const route = read("src/app/api/miniapp/appointments/[id]/checkin/route.ts");
    expect(route).toMatch(/if \(!canSelfCheckIn\(appt\.status\)\)/);
    expect(route).not.toMatch(/CHECKINABLE/);

    const hero = read("src/app/c/[slug]/my/_components/home-hero.tsx");
    expect(hero).toMatch(/const selfCheckIn = isToday && canSelfCheckIn\(appt\.status\);/);
    // Neither the button nor the «вас встретят» plaque renders without it.
    const block = hero.slice(hero.indexOf("interactive elements don't stack"));
    expect(block).toMatch(/^[^]*?\{selfCheckIn \? \(/);
    expect(block.slice(0, 200)).not.toMatch(/\{isToday \? \(/);
  });
});

describe("MA-23: NPS for a visit that took place, once", () => {
  it.each(["BOOKED", "CONFIRMED", "WAITING", "IN_PROGRESS", "CANCELLED", "NO_SHOW"])(
    "a %s visit is refused with 409 not_completed and writes nothing",
    async (status) => {
      state.appt = appt(status);
      const res = await submit(2);
      expect(res.status).toBe(409);
      expect((await res.json()).reason).toBe("not_completed");
      expect(state.creates).toHaveLength(0);
      expect(state.actions).toHaveLength(0);
    },
  );

  it("a COMPLETED visit is rated: lock, check, insert, event, in that order", async () => {
    state.appt = appt("COMPLETED");
    const res = await submit(9);
    expect(res.status).toBe(200);
    expect((await res.json()).reviewId).toBe("rev1");
    expect(state.calls[0]).toMatch(/^lock:SELECT pg_advisory_xact_lock\(7343, hashtext\(\?\)\)$/);
    expect(state.calls.slice(1)).toEqual(["findFirst", "create", "outbox"]);
    expect(state.calls).not.toContain("findFirst:outside-tx");
  });

  it("the second of two taps finds the first one's review under the lock: 409, no second row", async () => {
    state.appt = appt("COMPLETED");
    state.existingInTx = { id: "rev_first" };
    const res = await submit(3);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "already_submitted", reviewId: "rev_first" });
    expect(state.creates).toHaveLength(0);
    expect(state.calls).not.toContain("outbox");
    expect(state.actions).toHaveLength(0);
  });

  it("a low score sent for a relative names the relative in the admin alert", async () => {
    state.onBehalfOf = true;
    state.appt = appt("COMPLETED", "rel");
    const res = await submit(2, "?onBehalfOf=rel");
    expect(res.status).toBe(200);
    expect(state.creates[0]).toMatchObject({ patientId: "rel", adminAlerted: true });
    expect(state.actions[0]).toMatchObject({ patientId: "rel", patientName: "Relative Patient" });
  });

  it("the owner's own low score still names the owner", async () => {
    state.appt = appt("COMPLETED");
    await submit(2);
    expect(state.actions[0]).toMatchObject({ patientId: "owner", patientName: "Owner Patient" });
  });

  it("the Mini App shows no form for a visit not yet rateable and explains a refusal", () => {
    const screen = read("src/app/c/[slug]/my/_components/nps-screen.tsx");
    expect(screen).toMatch(/query\.data\.appointment\.status !== "COMPLETED"/);
    expect(screen).toMatch(/if \(notRateable\) return <MEmpty>\{t\.nps\.notCompleted\}<\/MEmpty>;/);
    expect(screen).toMatch(/reason === "not_completed"\) setErrMsg\(t\.nps\.notCompleted\)/);
    expect(read("src/app/c/[slug]/my/_messages/ru.ts")).toMatch(/notCompleted: "Оценить визит можно после приёма\."/);
    expect(read("src/app/c/[slug]/my/_messages/uz.ts")).toMatch(/notCompleted: "/);
  });
});

describe("MA-24: the public check never shows the cancel reason", () => {
  const sickLeave = {
    certNumber: "SL-0001",
    clinic: { nameRu: "NeuroFax", phone: "+998 71 275 28 18" },
    doctor: { name: "Султанов Азиз" },
    patient: { fullName: "Иванов Иван Иванович" },
    regimen: "OUTPATIENT",
    periodFrom: new Date("2026-09-24T00:00:00.000Z"),
    periodTo: new Date("2026-09-26T00:00:00.000Z"),
    issuedAt: new Date("2026-09-23T10:00:00Z"),
    status: "CANCELLED",
    cancelReason: "Ошибка в диагнозе G43.0, мигрень",
  };

  it("sick leave JSON: status CANCELLED, no reason field", async () => {
    state.sickLeave = sickLeave;
    const res = await verifySickLeave(
      new Request("https://x/api/verify/sick-leave/tok", { headers: { accept: "application/json" } }),
    );
    const body = await res.json();
    expect(body.status).toBe("CANCELLED");
    expect(body).not.toHaveProperty("cancelReason");
    expect(JSON.stringify(body)).not.toContain("G43");
  });

  it("sick leave HTML: «АННУЛИРОВАН», no reason text", async () => {
    state.sickLeave = sickLeave;
    const html = await (await verifySickLeave(new Request("https://x/api/verify/sick-leave/tok"))).text();
    expect(html).toContain("АННУЛИРОВАН");
    expect(html).not.toContain("Причина отмены");
    expect(html).not.toContain("G43");
  });

  it("prescription check: the same, JSON and HTML", async () => {
    state.recipe = {
      rxNumber: "RX-1",
      clinic: { nameRu: "NeuroFax", phone: null },
      doctor: { name: "Султанов Азиз" },
      patient: { fullName: "Иванов Иван" },
      issuedAt: new Date("2026-09-23T10:00:00Z"),
      validUntilAt: new Date("2026-10-23T10:00:00Z"),
      status: "CANCELLED",
      cancelReason: "Ошибка в диагнозе G43.0",
    };
    const json = await (
      await verifyRecipe(new Request("https://x/api/verify/recipe/tok", { headers: { accept: "application/json" } }))
    ).json();
    expect(json.status).toBe("CANCELLED");
    expect(json).not.toHaveProperty("cancelReason");
    const html = await (await verifyRecipe(new Request("https://x/api/verify/recipe/tok"))).text();
    expect(html).not.toContain("Причина отмены");
    expect(html).not.toContain("G43");
  });
});
