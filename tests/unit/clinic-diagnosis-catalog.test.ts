/**
 * Audit CT-05 — the clinic's self-learning diagnosis catalog.
 *
 * One doctor's code-less «мигрень» (picked through «Использовать как
 * написано») led the picker for every doctor of the clinic, above G43.0, and
 * conclusions went out without a code; a typo stayed in everyone's picker
 * with no way to remove it; and several code-less rows shared the React key
 * "". These tests pin the ranking, the «don't learn a classifier wording»
 * rule and the admin's delete.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  clinicId: string;
  code: string | null;
  nameRu: string;
  normalized: string;
  usageCount: number;
  createdById: string | null;
};

const state = {
  rows: [] as Row[],
  audits: [] as Array<{ action: string; meta: unknown }>,
  role: "ADMIN" as string,
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_admin", role: state.role, clinicId: "c1", email: "a@x.t" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_admin",
    role: state.role,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: unknown, a: { action: string; meta: unknown }) => {
    state.audits.push({ action: a.action, meta: a.meta });
  }),
}));

type Where = {
  id?: string;
  clinicId?: string;
  normalized?: string | { contains: string };
  OR?: Array<{ normalized?: { contains: string }; code?: { startsWith: string } }>;
};

function matches(r: Row, where: Where = {}): boolean {
  if (where.id !== undefined && r.id !== where.id) return false;
  if (where.clinicId !== undefined && r.clinicId !== where.clinicId) return false;
  if (typeof where.normalized === "string" && r.normalized !== where.normalized) {
    return false;
  }
  if (where.OR) {
    return where.OR.some(
      (o) =>
        (o.normalized && r.normalized.includes(o.normalized.contains)) ||
        (o.code && (r.code ?? "").toLowerCase().startsWith(o.code.startsWith.toLowerCase())),
    );
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinicDiagnosis: {
      findFirst: vi.fn(async ({ where }: { where: Where }) =>
        state.rows.find((r) => matches(r, where)) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: Where }) =>
        state.rows.filter((r) => matches(r, where)),
      ),
      count: vi.fn(async ({ where }: { where: Where }) =>
        state.rows.filter((r) => matches(r, where)).length,
      ),
      create: vi.fn(async ({ data }: { data: Omit<Row, "id" | "clinicId"> }) => {
        const row = { id: `cd_${state.rows.length + 1}`, clinicId: "c1", ...data };
        state.rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const row = state.rows.find((r) => matches(r, where))!;
        Object.assign(row, data);
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: Where }) => {
        const i = state.rows.findIndex((r) => matches(r, where));
        const [row] = state.rows.splice(i, 1);
        return row;
      }),
    },
    visitNote: { findMany: vi.fn(async () => []) },
  },
}));

import {
  diagnosisHitKey,
  learnClinicDiagnosis,
  mergeDiagnosisHits,
  searchClinicCatalog,
  type ClinicCatalogHit,
} from "@/server/icd10/clinic-catalog";
import { searchIcd10 } from "@/server/icd10/search";

const learned = (nameRu: string, code = "", usageCount = 40): ClinicCatalogHit => ({
  code,
  nameRu,
  custom: true,
  usageCount,
});

beforeEach(() => {
  state.rows = [];
  state.audits = [];
  state.role = "ADMIN";
});

describe("picker ranking: learned wordings vs the classifier", () => {
  it("puts G43 first for «мигр» even when the clinic wrote «мигрень» 40 times", () => {
    const rows = mergeDiagnosisHits(
      [learned("мигрень")],
      searchIcd10("мигр", 25),
      25,
    );
    expect(rows[0]!.code).toMatch(/^G43/);
    const firstUncoded = rows.findIndex((r) => !r.code);
    const lastCoded = rows.map((r) => Boolean(r.code)).lastIndexOf(true);
    expect(firstUncoded).toBeGreaterThan(lastCoded);
    // Still offered: a colleague's wording is one tap away.
    expect(rows.some((r) => r.nameRu === "мигрень")).toBe(true);
  });

  it("keeps a learned wording with a code the classifier lacks on top", () => {
    const rows = mergeDiagnosisHits(
      [learned("Мигрень с затяжной аурой", "G43.81")],
      searchIcd10("мигр", 12),
      12,
    );
    expect(rows[0]).toMatchObject({ code: "G43.81", custom: true });
  });

  it("drops a code-less copy of a classifier wording: the coded row says it", () => {
    const rows = mergeDiagnosisHits(
      [learned("Мигрень без ауры [простая мигрень]")],
      searchIcd10("мигрень без ауры", 12),
      12,
    );
    expect(rows.filter((r) => /без ауры/i.test(r.nameRu))).toEqual([
      expect.objectContaining({ code: "G43.0" }),
    ]);
  });

  it("gives every row a unique key, code-less ones included", () => {
    const rows = mergeDiagnosisHits(
      [learned("остеохондрох"), learned("остеохондроз шеи"), learned("остеохондроз шеи")],
      searchIcd10("остеохондр", 12),
      12,
    );
    const keys = rows.map(diagnosisHitKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.length).toBeLessThanOrEqual(12);
  });

  it("never lets learned wordings squeeze the list past its limit", () => {
    const rows = mergeDiagnosisHits(
      [learned("a1 мигрень"), learned("a2 мигрень"), learned("a3 мигрень")],
      searchIcd10("мигрень", 5),
      5,
    );
    expect(rows).toHaveLength(5);
    expect(rows.slice(0, 2).every((r) => r.code)).toBe(true);
  });
});

describe("learnClinicDiagnosis", () => {
  it("does not learn a classifier wording signed without a code", async () => {
    await learnClinicDiagnosis({
      code: null,
      nameRu: "Мигрень без ауры [простая мигрень]",
      createdById: "u_doc",
    });
    await learnClinicDiagnosis({
      code: null,
      nameRu: "мигрень без ауры, простая мигрень",
      createdById: "u_doc",
    });
    expect(state.rows).toEqual([]);
  });

  it("still learns the doctor's own wording", async () => {
    await learnClinicDiagnosis({
      code: null,
      nameRu: "Цервикалгия с мышечно-тоническим синдромом",
      createdById: "u_doc",
    });
    expect(state.rows).toHaveLength(1);
  });
});

describe("admin review of learned wordings", () => {
  const url = (id = "") => `https://x/api/crm/knowledge/diagnoses${id ? `/${id}` : ""}`;

  async function routes() {
    vi.resetModules();
    const list = await import("@/app/api/crm/knowledge/diagnoses/route");
    const one = await import("@/app/api/crm/knowledge/diagnoses/[id]/route");
    return { GET: list.GET, PATCH: one.PATCH, DELETE: one.DELETE };
  }

  beforeEach(async () => {
    await learnClinicDiagnosis({ code: null, nameRu: "остеохондрох", createdById: "u_doc" });
    await learnClinicDiagnosis({ code: null, nameRu: "мигрень", createdById: "u_doc" });
  });

  it("deletes a typo, and it leaves the picker", async () => {
    expect((await searchClinicCatalog("остеохонд", 5)).map((r) => r.nameRu)).toEqual([
      "остеохондрох",
    ]);
    const { DELETE } = await routes();
    const id = state.rows.find((r) => r.nameRu === "остеохондрох")!.id;
    const res = await DELETE(new Request(url(id), { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await searchClinicCatalog("остеохонд", 5)).toEqual([]);
    expect(state.audits.map((a) => a.action)).toEqual(["KNOWLEDGE_DIAGNOSIS_DELETED"]);
  });

  it("attaches the code a wording stands for", async () => {
    const { PATCH } = await routes();
    const id = state.rows.find((r) => r.nameRu === "мигрень")!.id;
    const res = await PATCH(
      new Request(url(id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "g43.9" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.rows.find((r) => r.id === id)!.code).toBe("G43.9");
  });

  it("refuses a code that is not an ICD code", async () => {
    const { PATCH } = await routes();
    const id = state.rows[0]!.id;
    const res = await PATCH(
      new Request(url(id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "мигрень" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("lists them most used first, for the admin only", async () => {
    const { GET, DELETE } = await routes();
    const res = await GET(new Request(url()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ nameRu: string }>; total: number };
    expect(body.total).toBe(2);

    state.role = "DOCTOR";
    expect((await GET(new Request(url()))).status).toBe(403);
    const id = state.rows[0]!.id;
    expect((await DELETE(new Request(url(id), { method: "DELETE" }))).status).toBe(403);
    expect(state.rows).toHaveLength(2);
  });
});
