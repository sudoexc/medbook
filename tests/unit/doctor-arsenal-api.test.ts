/**
 * «Мой арсенал» on the server: the arsenal API, the star cap, and the list
 * loaders the visit screen and the arsenal page share (owner request
 * 03.10.2026, «самые частые 10-20-30»).
 *
 *   - permissions: a doctor his own arsenal, the clinic's ADMIN any doctor
 *     of that clinic (the tenant read cannot even find another clinic's);
 *   - writes: pin at the end, 30 at most, a drag's whole permutation or
 *     nothing, a schema cleaned before it is stored, 10/20/30 only;
 *   - reads: bounded and scoped, text lines counted for their drug, the
 *     core list in clinic-wide use order, the clinic's diagnoses for a
 *     doctor with none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Fav = {
  id: string;
  userId: string;
  entityType: string;
  entityCode: string;
  sortOrder: number;
  createdAt: Date;
  schema: unknown;
};
type Doc = {
  id: string;
  userId: string | null;
  clinicId: string;
  nameRu: string;
  nameUz: string;
  frequentDrugLimit: number;
  frequentDiagnosisLimit: number;
};
type Note = {
  doctorId: string;
  clinicId: string;
  createdAt: Date;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  additionalDiagnoses: unknown;
  prescriptions: string[];
};

const db = vi.hoisted(() => ({
  ctx: {} as { kind: string; clinicId: string; userId: string; role: string },
  doctors: [] as Doc[],
  users: [] as { id: string; clinicId: string }[],
  favs: [] as Fav[],
  notes: [] as Note[],
  rx: [] as Array<Record<string, unknown> & { drugId: string | null; clinicId: string; at: Date; doctorId: string }>,
  formulary: [] as Array<{ drugId: string; label: string; aliases: string[]; strengths: string[]; sortOrder: number }>,
  hits: new Set<string>(),
  lineIds: new Map<string, string | null>(),
  lineCalls: [] as Array<{ lines: readonly string[]; opts: unknown }>,
  noteArgs: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  opts: [] as Array<{ roles?: string[] }>,
  seq: 0,
}));

const tenantDoctors = () => db.doctors.filter((d) => d.clinicId === db.ctx.clinicId);
const favsOf = (where: { userId?: string; entityType?: string }) =>
  db.favs
    .filter((f) => (!where.userId || f.userId === where.userId) && (!where.entityType || f.entityType === where.entityType))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
const byUnique = (w: { userId_entityType_entityCode?: { userId: string; entityType: string; entityCode: string }; id?: string }) =>
  w.id
    ? db.favs.find((f) => f.id === w.id)
    : db.favs.find(
        (f) =>
          f.userId === w.userId_entityType_entityCode!.userId &&
          f.entityType === w.userId_entityType_entityCode!.entityType &&
          f.entityCode === w.userId_entityType_entityCode!.entityCode,
      );

vi.mock("@/lib/prisma", () => {
  const prisma = {
    doctor: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; userId?: string } }) =>
        // The tenant extension: another clinic's doctor is not found.
        tenantDoctors().find((d) => (where.id ? d.id === where.id : d.userId === where.userId)) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Doc> }) => {
        const d = tenantDoctors().find((x) => x.id === where.id)!;
        Object.assign(d, data);
        return { id: d.id };
      }),
    },
    user: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; clinicId: string } }) =>
        db.users.find((u) => u.id === where.id && u.clinicId === where.clinicId) ?? null,
      ),
    },
    doctorFavorite: {
      findMany: vi.fn(async ({ where }: { where: { userId?: string; entityType?: string } }) => favsOf(where)),
      findUnique: vi.fn(async ({ where }: { where: Parameters<typeof byUnique>[0] }) => byUnique(where) ?? null),
      count: vi.fn(async ({ where }: { where: { userId?: string; entityType?: string } }) => favsOf(where).length),
      create: vi.fn(async ({ data }: { data: Omit<Fav, "id" | "createdAt" | "schema"> & { schema?: unknown } }) => {
        const row: Fav = { id: `f${++db.seq}`, createdAt: new Date(), schema: null, ...data };
        db.favs.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Parameters<typeof byUnique>[0]; data: Partial<Fav> }) => {
        const row = byUnique(where)!;
        Object.assign(row, data);
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        db.favs = db.favs.filter((f) => f.id !== where.id);
        return {};
      }),
    },
    visitNote: {
      findMany: vi.fn(async (args: { where: Record<string, unknown>; take: number }) => {
        db.noteArgs.push(args as Record<string, unknown>);
        const w = args.where as { doctorId?: string; diagnosisName?: unknown; NOT?: unknown };
        return db.notes
          .filter((n) => n.clinicId === db.ctx.clinicId)
          .filter((n) => !w.doctorId || n.doctorId === w.doctorId)
          .filter((n) => (w.diagnosisName ? !!n.diagnosisName : true))
          .filter((n) => (w.NOT ? n.prescriptions.length > 0 : true))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, args.take);
      }),
    },
    visitPrescription: {
      findMany: vi.fn(async ({ where }: { where: { visitNote: { doctorId: string } } }) =>
        db.rx
          .filter((r) => r.clinicId === db.ctx.clinicId && r.doctorId === where.visitNote.doctorId)
          .map((r) => ({ ...r, visitNote: { createdAt: r.at } })),
      ),
      groupBy: vi.fn(async ({ where }: { where: { drugId: { in: string[] } } }) => {
        const counts = new Map<string, number>();
        for (const r of db.rx) {
          if (r.clinicId !== db.ctx.clinicId || !r.drugId || !where.drugId.in.includes(r.drugId)) continue;
          counts.set(r.drugId, (counts.get(r.drugId) ?? 0) + 1);
        }
        return [...counts].map(([drugId, n]) => ({ drugId, _count: { _all: n } }));
      }),
    },
    clinicDiagnosis: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});

vi.mock("@/lib/api-handler", () => {
  const forbidden = () => Response.json({ error: "Forbidden" }, { status: 403 });
  return {
    createApiHandler:
      (
        opts: { roles?: string[]; bodySchema?: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) => {
        db.opts.push(opts);
        if (opts.roles && !opts.roles.includes(db.ctx.role)) return forbidden();
        let body: unknown;
        if (opts.bodySchema) {
          const parsed = opts.bodySchema.safeParse(await request.json());
          if (!parsed.success) return Response.json({ error: "Invalid" }, { status: 400 });
          body = parsed.data;
        }
        return handler({ request, body, ctx: db.ctx });
      },
    createApiListHandler:
      (
        opts: { roles?: string[] },
        handler: (a: { request: Request; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) => {
        db.opts.push(opts);
        if (opts.roles && !opts.roles.includes(db.ctx.role)) return forbidden();
        return handler({ request, ctx: db.ctx });
      },
  };
});

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_r: Request, input: Record<string, unknown>) => {
    db.audits.push(input);
  }),
}));

vi.mock("@/server/catalog/formulary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/catalog/formulary")>()),
  loadFormulary: vi.fn(async () => db.formulary),
}));

const NAMES: Record<string, { nameRu: string; brands: string[] }> = {
  mexidol: { nameRu: "Этилметилгидроксипиридина сукцинат", brands: ["Мексидол"] },
  betahistine: { nameRu: "Бетагистин", brands: ["Бетасерк"] },
  pregabalin: { nameRu: "Прегабалин", brands: ["Лирика"] },
  nimesulide: { nameRu: "Нимесулид", brands: ["Найз"] },
};

vi.mock("@/server/catalog/drug-hits", () => ({
  loadDrugHits: vi.fn(async (ids: string[]) => {
    const out = new Map<string, unknown>();
    for (const id of ids) {
      if (!db.hits.has(id)) continue;
      const n = NAMES[id] ?? { nameRu: id, brands: [] };
      out.set(id, {
        id,
        inn: id,
        nameRu: n.nameRu,
        nameUz: null,
        atcCode: "N07",
        category: "OTHER",
        forms: [{ form: "TAB", strengths: ["125 мг"] }],
        defaultDosing: null,
        rxOnly: true,
        photoUrl: null,
        clinicId: null,
        brands: n.brands.map((name, i) => ({ id: `${id}-${i}`, name, manufacturer: null })),
      });
    }
    return out;
  }),
}));

vi.mock("@/server/catalog/moved-brands", () => ({
  followMovedBrands: vi.fn(async (uses: unknown[]) => uses),
}));

vi.mock("@/server/visit-notes/legacy-line-drugs", () => ({
  resolveLineDrugIds: vi.fn(async (lines: readonly string[], opts: unknown) => {
    db.lineCalls.push({ lines, opts });
    return lines.map((l) => db.lineIds.get(l) ?? null);
  }),
}));

import {
  DELETE as arsenalDelete,
  GET as arsenalGet,
  PATCH as arsenalPatch,
  POST as arsenalPost,
} from "@/app/api/crm/doctor-arsenal/route";
import { POST as favoritePost } from "@/app/api/crm/doctor-favorites/route";
import { GET as drugShortlistGet } from "@/app/api/crm/doctors/me/drug-shortlist/route";
import { GET as diagnosisShortlistGet } from "@/app/api/crm/doctors/me/diagnosis-shortlist/route";
import {
  CLINIC_NOTES_LIMIT,
  loadDoctorDiagnosisLists,
  loadDoctorDrugLists,
} from "@/server/catalog/doctor-lists";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

const DOCTOR = (over: Partial<Doc> = {}): Doc => ({
  id: "doc_aziz",
  userId: "u_aziz",
  clinicId: "c1",
  nameRu: "Султанов Азиз",
  nameUz: "Sultanov Aziz",
  frequentDrugLimit: 20,
  frequentDiagnosisLimit: 20,
  ...over,
});

function asDoctor() {
  db.ctx = { kind: "TENANT", clinicId: "c1", userId: "u_aziz", role: "DOCTOR" };
}
function asAdmin(clinicId = "c1") {
  db.ctx = { kind: "TENANT", clinicId, userId: "u_admin", role: "ADMIN" };
}

function req(method: string, body?: unknown, query = ""): Request {
  return new Request(`http://x/api/crm/doctor-arsenal${query}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function pin(entityCode: string, sortOrder: number, entityType = "DRUG", userId = "u_aziz", schema: unknown = null): Fav {
  return { id: `p_${entityType}_${entityCode}`, userId, entityType, entityCode, sortOrder, createdAt: ago(1), schema };
}

beforeEach(() => {
  db.doctors = [
    DOCTOR(),
    DOCTOR({ id: "doc_other", userId: "u_other", nameRu: "Коллега", nameUz: "Hamkasb" }),
    DOCTOR({ id: "doc_nologin", userId: null, nameRu: "Без логина", nameUz: "Loginsiz" }),
    DOCTOR({ id: "doc_far", userId: "u_far", clinicId: "c2", nameRu: "Чужой", nameUz: "Begona" }),
  ];
  db.users = [
    { id: "u_aziz", clinicId: "c1" },
    { id: "u_other", clinicId: "c1" },
    { id: "u_far", clinicId: "c2" },
  ];
  db.favs = [];
  db.notes = [];
  db.rx = [];
  db.formulary = [];
  db.hits = new Set(["mexidol", "betahistine", "pregabalin", "nimesulide"]);
  db.lineIds = new Map();
  db.lineCalls = [];
  db.noteArgs = [];
  db.audits = [];
  db.opts = [];
  db.seq = 0;
  asDoctor();
});

// ── Permissions ──────────────────────────────────────────────────────────

describe("whose arsenal, and who may touch it", () => {
  it("doctors and the clinic's ADMIN only", async () => {
    await arsenalGet(req("GET", undefined, "?kind=DRUG"));
    expect(db.opts.at(-1)!.roles).toEqual(["ADMIN", "DOCTOR"]);
    db.ctx = { kind: "TENANT", clinicId: "c1", userId: "u_nurse", role: "NURSE" };
    expect((await arsenalGet(req("GET", undefined, "?kind=DRUG"))).status).toBe(403);
  });

  it("a doctor opens his own, never a colleague's", async () => {
    const own = await arsenalGet(req("GET", undefined, "?kind=ICD10"));
    expect(own.status).toBe(200);
    expect(((await own.json()) as { doctor: { id: string } }).doctor.id).toBe("doc_aziz");
    // Naming himself is fine too.
    expect((await arsenalGet(req("GET", undefined, "?kind=ICD10&doctorId=doc_aziz"))).status).toBe(200);
    expect((await arsenalGet(req("GET", undefined, "?kind=ICD10&doctorId=doc_other"))).status).toBe(403);
    expect((await arsenalPost(req("POST", { doctorId: "doc_other", kind: "ICD10", code: "G43.0" }))).status).toBe(403);
    expect(db.favs).toEqual([]);
  });

  it("the ADMIN prepares any doctor's of his clinic, under that doctor's login", async () => {
    asAdmin();
    const res = await arsenalPost(req("POST", { doctorId: "doc_other", kind: "ICD10", code: "g43.0" }));
    expect(res.status).toBe(200);
    expect(db.favs).toMatchObject([{ userId: "u_other", entityType: "ICD10", entityCode: "G43.0" }]);
    expect(db.audits.at(-1)).toMatchObject({
      action: "DOCTOR_FAVORITE_ADDED",
      meta: { doctorId: "doc_other", userId: "u_other", via: "arsenal" },
    });
  });

  it("another clinic's doctor is not even found; a card without a login has nowhere to keep pins", async () => {
    asAdmin();
    expect((await arsenalGet(req("GET", undefined, "?kind=DRUG&doctorId=doc_far"))).status).toBe(404);
    const noLogin = await arsenalGet(req("GET", undefined, "?kind=DRUG&doctorId=doc_nologin"));
    expect(noLogin.status).toBe(409);
    expect(await noLogin.json()).toMatchObject({ reason: "doctor_has_no_login" });
    // A login of another clinic linked to this card: refused as well.
    db.doctors.push(DOCTOR({ id: "doc_odd", userId: "u_far" }));
    expect((await arsenalGet(req("GET", undefined, "?kind=DRUG&doctorId=doc_odd"))).status).toBe(409);
  });
});

// ── Writes ───────────────────────────────────────────────────────────────

describe("pins: at the end, 30 at most, visible drugs only", () => {
  it("a new pin lands after the others; the same pin twice is one", async () => {
    db.favs = [pin("mexidol", 0), pin("nimesulide", 1)];
    const res = await arsenalPost(req("POST", { kind: "DRUG", code: "pregabalin" }));
    expect(await res.json()).toEqual({ created: true, code: "pregabalin" });
    const added = db.favs.find((f) => f.entityCode === "pregabalin")!;
    expect(added.sortOrder).toBeGreaterThan(1);
    const again = await arsenalPost(req("POST", { kind: "DRUG", code: "pregabalin" }));
    expect(await again.json()).toEqual({ created: false, code: "pregabalin" });
    expect(db.favs.filter((f) => f.entityCode === "pregabalin")).toHaveLength(1);
  });

  it("the 31st is refused with a reason; a drug the clinic cannot see is refused", async () => {
    db.hits.add("extra");
    db.favs = Array.from({ length: 30 }, (_, i) => pin(`d${i}`, i));
    const full = await arsenalPost(req("POST", { kind: "DRUG", code: "extra" }));
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ reason: "arsenal_full", max: 30 });
    db.favs = [];
    const hidden = await arsenalPost(req("POST", { kind: "DRUG", code: "hidden_drug" }));
    expect(hidden.status).toBe(404);
  });

  it("a star on the visit screen is capped the same way, other catalogs are not", async () => {
    db.favs = Array.from({ length: 30 }, (_, i) => pin(`d${i}`, i));
    const star = new Request("http://x/api/crm/doctor-favorites", {
      method: "POST",
      body: JSON.stringify({ entityType: "DRUG", entityCode: "extra" }),
    });
    const res = await favoritePost(star);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "arsenal_full" });
    const protocol = await favoritePost(
      new Request("http://x/api/crm/doctor-favorites", {
        method: "POST",
        body: JSON.stringify({ entityType: "PROTOCOL", entityCode: "HTN" }),
      }),
    );
    expect(protocol.status).toBe(200);
  });

  it("an ICD pin written in another case is the same code: found, moved, removed", async () => {
    db.favs = [pin("g43.0", 0, "ICD10"), pin("G44.2", 1, "ICD10")];
    expect(await (await arsenalPost(req("POST", { kind: "ICD10", code: "G43.0" }))).json()).toEqual({
      created: false,
      code: "G43.0",
    });
    expect((await arsenalPatch(req("PATCH", { op: "reorder", kind: "ICD10", codes: ["G44.2", "G43.0"] }))).status).toBe(200);
    expect(favsOf({ userId: "u_aziz", entityType: "ICD10" }).map((f) => f.entityCode)).toEqual(["G44.2", "g43.0"]);
    await arsenalDelete(req("DELETE", { kind: "ICD10", code: "G43.0" }));
    expect(db.favs.map((f) => f.entityCode)).toEqual(["G44.2"]);
  });

  it("unpin removes the row and says so", async () => {
    db.favs = [pin("mexidol", 0)];
    const res = await arsenalDelete(req("DELETE", { kind: "DRUG", code: "mexidol" }));
    expect(await res.json()).toEqual({ removed: true });
    expect(db.favs).toEqual([]);
  });
});

describe("a drag saves the whole order, or nothing", () => {
  it("positions become 0..n-1 in the dragged order", async () => {
    db.favs = [pin("a", 1_790_000_000), pin("b", 1_790_000_001), pin("c", 1_790_000_002)];
    db.hits = new Set(["a", "b", "c"]);
    const res = await arsenalPatch(req("PATCH", { op: "reorder", kind: "DRUG", codes: ["c", "a", "b"] }));
    expect(res.status).toBe(200);
    expect(favsOf({ userId: "u_aziz", entityType: "DRUG" }).map((f) => [f.entityCode, f.sortOrder])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
    expect(db.audits.at(-1)).toMatchObject({ action: "DOCTOR_ARSENAL_REORDERED", entityId: "doc_aziz" });
  });

  it("an order made on a list that changed meanwhile is refused, untouched", async () => {
    db.favs = [pin("a", 0), pin("b", 1), pin("c", 2)];
    const res = await arsenalPatch(req("PATCH", { op: "reorder", kind: "DRUG", codes: ["b", "a"] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "order_stale", codes: ["a", "b", "c"] });
    expect(db.favs.map((f) => f.sortOrder)).toEqual([0, 1, 2]);
  });
});

describe("a drug's schema and the «10 · 20 · 30» choice", () => {
  it("stored cleaned; an empty one is a database NULL; only on a pinned drug", async () => {
    db.favs = [pin("mexidol", 0)];
    const res = await arsenalPatch(
      req("PATCH", {
        op: "schema",
        code: "mexidol",
        schema: { dose: " 1 таб. ", timesOfDay: ["EVENING", "MORNING"], mealRelation: "AFTER_MEAL", durationDays: 10 },
      }),
    );
    expect(res.status).toBe(200);
    expect(db.favs[0]!.schema).toEqual({
      form: null,
      strength: null,
      dose: "1 таб.",
      timesOfDay: ["MORNING", "EVENING"],
      mealRelation: "AFTER_MEAL",
      durationDays: 10,
      instructionRu: null,
      instructionUz: null,
    });
    await arsenalPatch(req("PATCH", { op: "schema", code: "mexidol", schema: { mealRelation: "NO_MATTER" } }));
    const { Prisma } = await import("@/generated/prisma/client");
    expect(db.favs[0]!.schema).toBe(Prisma.DbNull);
    expect((await arsenalPatch(req("PATCH", { op: "schema", code: "pregabalin", schema: null }))).status).toBe(404);
    // A value the API does not know is refused at the door.
    expect(
      (await arsenalPatch(req("PATCH", { op: "schema", code: "mexidol", schema: { durationDays: 0 } }))).status,
    ).toBe(400);
  });

  it("10, 20 or 30 per kind, on the doctor's card", async () => {
    expect((await arsenalPatch(req("PATCH", { op: "limit", kind: "DRUG", limit: 30 }))).status).toBe(200);
    expect((await arsenalPatch(req("PATCH", { op: "limit", kind: "ICD10", limit: 10 }))).status).toBe(200);
    expect(db.doctors[0]).toMatchObject({ frequentDrugLimit: 30, frequentDiagnosisLimit: 10 });
    expect((await arsenalPatch(req("PATCH", { op: "limit", kind: "DRUG", limit: 25 }))).status).toBe(400);
    expect(db.audits.at(-1)).toMatchObject({ action: "DOCTOR_FREQUENT_LIMIT_SET" });
  });
});

// ── Reads ────────────────────────────────────────────────────────────────

describe("the drug lists", () => {
  beforeEach(() => {
    db.formulary = [
      { drugId: "pregabalin", label: "Лирика", aliases: [], strengths: ["75 мг"], sortOrder: 0 },
      { drugId: "betahistine", label: "Бетасерк", aliases: [], strengths: ["24 мг"], sortOrder: 1 },
    ];
    db.rx = [
      { drugId: "mexidol", displayName: "Мексидол", dose: "125 мг", form: "TAB", strength: "125 мг", timesOfDay: ["MORNING"], mealRelation: "AFTER_MEAL", durationDays: 10, clinicId: "c1", doctorId: "doc_aziz", at: ago(3) },
      // A colleague writes Бетасерк: the clinic uses it more than Лирика.
      { drugId: "betahistine", displayName: "Бетасерк", dose: "24 мг", form: null, strength: null, timesOfDay: [], mealRelation: "NO_MATTER", durationDays: null, clinicId: "c1", doctorId: "doc_other", at: ago(2) },
      { drugId: "betahistine", displayName: "Бетасерк", dose: "24 мг", form: null, strength: null, timesOfDay: [], mealRelation: "NO_MATTER", durationDays: null, clinicId: "c1", doctorId: "doc_other", at: ago(2) },
    ];
    db.notes = [
      { doctorId: "doc_aziz", clinicId: "c1", createdAt: ago(1), diagnosisCode: null, diagnosisName: null, additionalDiagnoses: [], prescriptions: ["Мексидол 5,0 в/м №10", "Циннаризин 25 мг"] },
    ];
    db.lineIds = new Map([
      ["Мексидол 5,0 в/м №10", "mexidol"],
      ["Циннаризин 25 мг", "cinnarizine"],
    ]);
  });

  it("text lines count for their drug, matched within the clinic; the core list by clinic use", async () => {
    db.favs = [
      pin("pregabalin", 0, "DRUG", "u_aziz", { dose: "1 капс.", timesOfDay: ["NIGHT"] }),
      pin("retired", 1),
    ];
    const lists = await loadDoctorDrugLists({
      doctor: { id: "doc_aziz", userId: "u_aziz", frequentDrugLimit: 30 },
      clinicId: "c1",
      days: 365,
      limit: 12,
    });
    expect(db.lineCalls[0]!.opts).toEqual({ clinicId: "c1" });
    expect(lists.frequent.map((f) => [f.drugId, f.count])).toEqual([
      ["mexidol", 2],
      ["cinnarizine", 1],
    ]);
    // A line-only drug the clinic cannot show: his line, no catalog row.
    expect(lists.frequent[1]).toMatchObject({ label: "Циннаризин 25 мг", lineOnly: true, drug: null });
    expect(lists.coreRank).toEqual(["betahistine", "pregabalin"]);
    expect(lists.frequentLimit).toBe(30);
    // «Мои»: the arsenal with its schema; a retired drug is kept on the page only.
    expect(lists.starred.map((s) => [s.drugId, s.arsenalSchema?.dose ?? null])).toEqual([["pregabalin", "1 капс."]]);
    expect(lists.arsenal.map((p) => [p.code, p.entry ? "ok" : "gone"])).toEqual([
      ["pregabalin", "ok"],
      ["retired", "gone"],
    ]);
    // The page's «В арсенал» shows drugs by their catalog name.
    expect(lists.topCatalog.map((t) => t.drugId)).toEqual(["mexidol"]);
  });

  it("a line in the clinic's own words lands on its core drug when the catalog matcher cannot place it", async () => {
    db.notes = [
      { doctorId: "doc_aziz", clinicId: "c1", createdAt: ago(1), diagnosisCode: null, diagnosisName: null, additionalDiagnoses: [], prescriptions: ["Лирика 75 мг на ночь"] },
    ];
    db.lineIds = new Map();
    const lists = await loadDoctorDrugLists({ doctor: { id: "doc_aziz", userId: "u_aziz" }, clinicId: "c1", days: 365, limit: 12 });
    const lyrica = lists.frequent.find((f) => f.drugId === "pregabalin");
    expect(lyrica).toMatchObject({ count: 1, lineOnly: true, label: "Лирика 75 мг на ночь" });
  });

  it("the visit screen gets the new fields and not the page's extras", async () => {
    const res = await drugShortlistGet(new Request("http://x/api/crm/doctors/me/drug-shortlist"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["clinic", "core", "coreRank", "frequent", "frequentLimit", "mine", "starred", "usual", "windowDays"].sort(),
    );
    expect(body.frequentLimit).toBe(20);
  });

  it("reads are bounded: his last year, 1000 notes", async () => {
    await loadDoctorDrugLists({ doctor: { id: "doc_aziz", userId: "u_aziz" }, clinicId: "c1", days: 365, limit: 12 });
    const his = db.noteArgs.find((a) => (a.where as { doctorId?: string }).doctorId === "doc_aziz")!;
    expect(his.take).toBe(1000);
    const since = (his.where as { createdAt: { gte: Date } }).createdAt.gte;
    expect(Math.round((Date.now() - since.getTime()) / DAY)).toBe(365);
    const clinic = db.noteArgs.find((a) => !(a.where as { doctorId?: string }).doctorId)!;
    expect(clinic.take).toBe(CLINIC_NOTES_LIMIT);
    expect(CLINIC_NOTES_LIMIT).toBe(400);
  });

  it("the arsenal page gets his top not yet pinned, and the core list not yet pinned, by clinic use", async () => {
    db.favs = [pin("betahistine", 0)];
    const res = await arsenalGet(req("GET", undefined, "?kind=DRUG"));
    const body = (await res.json()) as { items: { code: string }[]; top: { drugId: string }[]; core: { drugId: string }[]; max: number };
    expect(body.max).toBe(30);
    expect(body.items.map((i) => i.code)).toEqual(["betahistine"]);
    expect(body.top.map((t) => t.drugId)).toEqual(["mexidol"]);
    expect(body.core.map((c) => c.drugId)).toEqual(["pregabalin"]);
  });
});

describe("the diagnosis lists", () => {
  const note = (doctorId: string, code: string, name: string, days: number): Note => ({
    doctorId,
    clinicId: "c1",
    createdAt: ago(days),
    diagnosisCode: code,
    diagnosisName: name,
    additionalDiagnoses: [],
    prescriptions: [],
  });

  it("his own when he has any: one read, no clinic fallback", async () => {
    db.notes = [note("doc_aziz", "G44.2", "ГБН", 1), note("doc_aziz", "G44.2", "ГБН", 2), note("doc_other", "M54.4", "Люмбаго", 1)];
    const lists = await loadDoctorDiagnosisLists({ doctor: { id: "doc_aziz", userId: "u_aziz" }, days: 365, limit: 12 });
    expect(lists.frequentSource).toBe("own");
    expect(lists.frequent.map((f) => [f.code, f.count])).toEqual([["G44.2", 2]]);
    expect(db.noteArgs).toHaveLength(1);
    expect(db.noteArgs[0]!.take).toBe(3000);
  });

  it("a doctor with none starts from the clinic's most common, from its last 400 notes", async () => {
    db.notes = [note("doc_other", "M54.4", "Люмбаго", 1), note("doc_other", "M54.4", "Люмбаго", 2), note("doc_other", "G43.0", "Мигрень", 3)];
    const lists = await loadDoctorDiagnosisLists({ doctor: { id: "doc_aziz", userId: "u_aziz", frequentDiagnosisLimit: 10 }, days: 365, limit: 12 });
    expect(lists.frequentSource).toBe("clinic");
    expect(lists.frequent.map((f) => f.code)).toEqual(["M54.4", "G43.0"]);
    expect(lists.frequentLimit).toBe(10);
    const clinicRead = db.noteArgs[1]!;
    expect(clinicRead.where).not.toHaveProperty("doctorId");
    expect(clinicRead.take).toBe(400);
  });

  it("the visit screen's route says whose «Частые» they are; «Мои» follows the arsenal order", async () => {
    db.notes = [note("doc_aziz", "G44.2", "ГБН", 1)];
    db.favs = [pin("M54.4", 5, "ICD10"), pin("G43.0", 1, "ICD10")];
    const res = await diagnosisShortlistGet(new Request("http://x/api/crm/doctors/me/diagnosis-shortlist"));
    const body = (await res.json()) as { frequentSource: string; frequentLimit: number; starred: { code: string }[] };
    expect(body.frequentSource).toBe("own");
    expect(body.frequentLimit).toBe(20);
    expect(body.starred.map((s) => s.code)).toEqual(["G43.0", "M54.4"]);
  });
});
