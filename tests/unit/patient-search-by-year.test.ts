/**
 * Audit PT-03: the doctor searches «Турматов 1969» (surname + birth year),
 * the way he writes patients on paper.
 *
 * The old test copied the route's query SHAPE and only checked that an `AND`
 * key existed, so it passed while the real query (that AND joined with an OR
 * over the whole term) matched nobody. These tests run the real GET handler
 * against a fixture table: prisma is replaced by a small evaluator of the
 * Prisma `where` operators the search uses, so what is pinned is WHICH
 * patients come back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  fullName: string;
  phone: string;
  phoneNormalized: string;
  passport: string | null;
  telegramUsername: string | null;
  birthDate: Date | null;
  segment: string;
  notes: string | null;
  createdAt: Date;
};

const state = vi.hoisted(() => ({ rows: [] as Row[] }));

// ── A minimal Prisma `where` evaluator ─────────────────────────────────────
type Cond = Record<string, unknown>;

function matchField(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date) {
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
    return value === cond;
  }
  const c = cond as Cond;
  const insensitive = c.mode === "insensitive";
  const norm = (v: unknown) =>
    typeof v === "string" && insensitive ? v.toLowerCase() : v;
  for (const [op, arg] of Object.entries(c)) {
    if (op === "mode") continue;
    const v = value instanceof Date ? value.getTime() : value;
    const a = arg instanceof Date ? arg.getTime() : arg;
    switch (op) {
      case "contains":
        if (typeof value !== "string" || !(norm(value) as string).includes(norm(arg) as string)) return false;
        break;
      case "startsWith":
        if (typeof value !== "string" || !(norm(value) as string).startsWith(norm(arg) as string)) return false;
        break;
      case "equals":
        if (v !== a) return false;
        break;
      case "in":
        if (!(arg as unknown[]).includes(value)) return false;
        break;
      case "has":
        if (!Array.isArray(value) || !value.includes(arg)) return false;
        break;
      case "gte":
        if (v === null || v === undefined || (v as number) < (a as number)) return false;
        break;
      case "gt":
        if (v === null || v === undefined || (v as number) <= (a as number)) return false;
        break;
      case "lte":
        if (v === null || v === undefined || (v as number) > (a as number)) return false;
        break;
      case "lt":
        if (v === null || v === undefined || (v as number) >= (a as number)) return false;
        break;
      default:
        throw new Error(`evaluator: unsupported operator ${op}`);
    }
  }
  return true;
}

function matches(row: Record<string, unknown>, where: Cond | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND") {
      const list = Array.isArray(cond) ? cond : [cond];
      if (!list.every((w) => matches(row, w as Cond))) return false;
    } else if (key === "OR") {
      if (!(cond as Cond[]).some((w) => matches(row, w))) return false;
    } else if (key === "NOT") {
      if (matches(row, cond as Cond)) return false;
    } else if (!matchField(row[key], cond)) {
      return false;
    }
  }
  return true;
}

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "DOCTOR" };
  return {
    createApiHandler: () => async () => new Response(null, { status: 405 }),
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

vi.mock("@/lib/prisma", () => {
  const filter = (where: Cond | undefined) =>
    state.rows.filter((r) => matches(r as unknown as Record<string, unknown>, where));
  return {
    prisma: {
      patient: {
        findMany: vi.fn(async ({ where, take }: { where?: Cond; take?: number }) =>
          filter(where).slice(0, take ?? undefined),
        ),
        count: vi.fn(async ({ where }: { where?: Cond }) => filter(where).length),
        groupBy: vi.fn(async ({ where }: { where?: Cond }) => {
          const bySegment = new Map<string, number>();
          for (const r of filter(where)) {
            bySegment.set(r.segment, (bySegment.get(r.segment) ?? 0) + 1);
          }
          return [...bySegment].map(([segment, n]) => ({ segment, _count: { _all: n } }));
        }),
      },
    },
  };
});

function patient(p: Partial<Row> & Pick<Row, "id" | "fullName">): Row {
  return {
    phone: "",
    phoneNormalized: `tg:${p.id}`,
    passport: null,
    telegramUsername: null,
    birthDate: null,
    segment: "ACTIVE",
    notes: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    ...p,
  };
}

const TURMATOV_1969 = patient({
  id: "p_turmatov",
  fullName: "Турматов Отабек",
  // No «1969» anywhere in the phone: the year lives in the birth date only.
  phone: "+998 90 111 22 33",
  phoneNormalized: "+998901112233",
  birthDate: new Date(Date.UTC(1969, 0, 1)),
});
const TURMATOV_1972 = patient({
  id: "p_turmatov_72",
  fullName: "Турматов Бахтиёр",
  phone: "+998 90 444 55 66",
  phoneNormalized: "+998904445566",
  birthDate: new Date(Date.UTC(1972, 4, 5)),
});
const KARIMOV_1969 = patient({
  id: "p_karimov",
  fullName: "Каримов Анвар",
  phone: "+998 93 777 88 99",
  phoneNormalized: "+998937778899",
  birthDate: new Date(Date.UTC(1969, 2, 10)),
});
// Typed before the year was lifted into `birthDate`: still in the name.
const LEGACY_TURMATOV = patient({
  id: "p_legacy",
  fullName: "Турматов О 1969",
  phone: "+998 97 123 45 67",
  phoneNormalized: "+998971234567",
  birthDate: null,
});
const PHONE_WITH_1969 = patient({
  id: "p_aliev",
  fullName: "Алиев Рустам",
  phone: "+998 90 196 90 00",
  phoneNormalized: "+998901969000",
  birthDate: new Date(Date.UTC(1980, 6, 1)),
  segment: "VIP",
});

beforeEach(() => {
  state.rows = [TURMATOV_1969, TURMATOV_1972, KARIMOV_1969, LEGACY_TURMATOV, PHONE_WITH_1969];
});

async function search(q: string, extra = ""): Promise<{ ids: string[]; total: number }> {
  const { GET } = await import("@/app/api/crm/patients/route");
  const res = await GET(
    new Request(`https://x/api/crm/patients?q=${encodeURIComponent(q)}&limit=8${extra}`),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rows: Array<{ id: string }>; total: number };
  return { ids: body.rows.map((r) => r.id).sort(), total: body.total };
}

describe("GET /api/crm/patients?q= «Фамилия ГГГГ» (audit PT-03)", () => {
  it("«Турматов 1969» finds Турматов Отабек born 1969, whose phone has no «1969»", async () => {
    const { ids, total } = await search("Турматов 1969");
    expect(ids).toContain("p_turmatov");
    // Same surname, other year; same year, other surname; «1969» in a phone.
    expect(ids).not.toContain("p_turmatov_72");
    expect(ids).not.toContain("p_karimov");
    expect(ids).not.toContain("p_aliev");
    expect(total).toBe(ids.length);
  });

  it("still finds a card that keeps the year inside its name", async () => {
    const { ids } = await search("Турматов 1969");
    expect(ids).toEqual(["p_legacy", "p_turmatov"]);
  });

  it("surname with initial, any case, trailing spaces", async () => {
    const { ids } = await search("турматов о 1969  ");
    expect(ids).toEqual(["p_legacy", "p_turmatov"]);
  });

  it("a plain surname finds every card with it", async () => {
    const { ids } = await search("Турматов");
    expect(ids).toEqual(["p_legacy", "p_turmatov", "p_turmatov_72"]);
  });

  it("a bare year finds everyone born that year, plus text matches of the digits", async () => {
    const { ids } = await search("1969");
    expect(ids).toEqual(["p_aliev", "p_karimov", "p_legacy", "p_turmatov"]);
  });

  it("a phone number is not mistaken for a year", async () => {
    const { ids } = await search("998901112233");
    expect(ids).toEqual(["p_turmatov"]);
  });

  it("a future year is plain text, not a birth-year filter", async () => {
    const { ids } = await search("Турматов 2099");
    expect(ids).toEqual([]);
  });

  it("combines with the other list filters instead of replacing them", async () => {
    state.rows = [...state.rows, { ...TURMATOV_1969, id: "p_turmatov_vip", segment: "VIP" }];
    const { ids } = await search("Турматов 1969", "&segment=VIP");
    expect(ids).toEqual(["p_turmatov_vip"]);
  });
});

describe("the same search in «Мои пациенты» and the top bar", () => {
  it("patientSearchWhere never mixes the whole term into a year query", async () => {
    const { patientSearchWhere } = await import("@/server/patient/search-where");
    const where = patientSearchWhere("Турматов 1969", new Date("2026-09-25T00:00:00Z"));
    expect(JSON.stringify(where)).not.toContain("Турматов 1969");
    const found = state.rows.filter((r) =>
      matches(r as unknown as Record<string, unknown>, where!),
    );
    expect(found.map((r) => r.id).sort()).toEqual(["p_legacy", "p_turmatov"]);
    expect(patientSearchWhere("   ")).toBeNull();
  });
});
