/**
 * Unit tests for the Phase 13 Wave 1 Action Center REST handlers.
 *
 * Strategy mirrors `tests/unit/onboarding-status.test.ts` and
 * `tests/unit/appointment-reschedule-audit.test.ts`: mock auth, prisma,
 * tenant-context, branch-cookie, and pin modules so the handlers run with
 * a deterministic in-memory state.
 *
 * Coverage:
 *   - snooze sets snoozeUntil + emits ACTION_SNOOZED audit
 *   - dismiss sets dismissedAt + emits ACTION_DISMISSED audit
 *   - done sets doneAt + emits ACTION_DONE audit
 *   - reopen requires ADMIN; RECEPTIONIST gets 403
 *   - list filters by status, severity, type
 *   - list hides actively snoozed rows (snoozeUntil > now)
 *   - list excludes EXPIRED rows
 *   - list orders by severity, then by when a row became actionable
 *     (`surfacedAt`), before the limit; a resurfaced task is not buried
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ----- shared in-memory state ---------------------------------------------

type ActionRow = {
  id: string;
  clinicId: string;
  branchId: string | null;
  type: string;
  severity: string;
  payload: Record<string, unknown>;
  status: string;
  assigneeRole: string | null;
  deeplinkPath: string | null;
  dedupeKey: string;
  snoozeUntil: Date | null;
  dismissedAt: Date | null;
  doneAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  surfacedAt: Date;
};

const state = {
  rows: [] as ActionRow[],
  audits: [] as Array<{ action: string; entityId: string | null; meta: unknown }>,
};

const sessionRef: {
  current: { user: { id: string; role: string; clinicId: string | null; email?: string } } | null;
} = {
  current: {
    user: {
      id: "u_admin",
      role: "ADMIN",
      clinicId: "c1",
      email: "admin@example.test",
    },
  },
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => sessionRef.current),
}));

vi.mock("@/lib/pin", () => ({
  hasValidPin: () => false,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: sessionRef.current?.user.id ?? "u_unknown",
    role: (sessionRef.current?.user.role ?? "ADMIN") as
      | "ADMIN"
      | "RECEPTIONIST"
      | "DOCTOR",
  }),
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

// ----- prisma mock --------------------------------------------------------

function applyWhere(rows: ActionRow[], where: Record<string, unknown> | undefined): ActionRow[] {
  if (!where) return rows;
  return rows.filter((row) => matches(row, where));
}

function matches(row: ActionRow, where: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(where)) {
    if (key === "AND") {
      const arr = val as Array<Record<string, unknown>>;
      if (!arr.every((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "OR") {
      const arr = val as Array<Record<string, unknown>>;
      if (!arr.some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "id" && typeof val === "object" && val && "in" in val) {
      const ids = (val as { in: string[] }).in;
      if (!ids.includes(row.id)) return false;
      continue;
    }
    const rowVal = (row as unknown as Record<string, unknown>)[key];
    if (val === null) {
      if (rowVal !== null && rowVal !== undefined) return false;
      continue;
    }
    if (val instanceof Date) {
      if (!(rowVal instanceof Date) || rowVal.getTime() !== val.getTime()) return false;
      continue;
    }
    if (typeof val === "object" && val) {
      const v = val as Record<string, unknown>;
      if ("in" in v) {
        const arr = v.in as unknown[];
        if (!arr.includes(rowVal)) return false;
        continue;
      }
      if ("notIn" in v) {
        const arr = v.notIn as unknown[];
        if (arr.includes(rowVal)) return false;
        continue;
      }
      if ("lt" in v) {
        const lt = v.lt;
        const ok =
          lt instanceof Date
            ? rowVal instanceof Date && rowVal.getTime() < lt.getTime()
            : String(rowVal) < String(lt);
        if (!ok) return false;
        continue;
      }
      if ("gt" in v) {
        if (!(rowVal instanceof Date) || rowVal.getTime() <= (v.gt as Date).getTime()) {
          return false;
        }
        continue;
      }
      if ("lte" in v) {
        if (!(rowVal instanceof Date) || rowVal.getTime() > (v.lte as Date).getTime()) {
          return false;
        }
        continue;
      }
    }
    if (rowVal !== val) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    action: {
      findUnique: vi.fn(
        async ({ where }: { where: { id?: string; clinicId_dedupeKey?: { clinicId: string; dedupeKey: string } } }) => {
          if (where.id) return state.rows.find((r) => r.id === where.id) ?? null;
          if (where.clinicId_dedupeKey) {
            const { clinicId, dedupeKey } = where.clinicId_dedupeKey;
            return (
              state.rows.find(
                (r) => r.clinicId === clinicId && r.dedupeKey === dedupeKey,
              ) ?? null
            );
          }
          return null;
        },
      ),
      findMany: vi.fn(
        async ({
          where,
          orderBy,
          take,
        }: {
          where?: Record<string, unknown>;
          orderBy?: Array<Record<string, "asc" | "desc">>;
          take?: number;
        }) => {
          let rows = applyWhere(state.rows, where);
          if (orderBy && orderBy.length > 0) {
            const orders = orderBy;
            rows = [...rows].sort((a, b) => {
              for (const o of orders) {
                for (const [k, dir] of Object.entries(o)) {
                  const av = (a as unknown as Record<string, unknown>)[k];
                  const bv = (b as unknown as Record<string, unknown>)[k];
                  if (av === bv) continue;
                  const cmp =
                    av === undefined || av === null
                      ? -1
                      : bv === undefined || bv === null
                        ? 1
                        : av instanceof Date && bv instanceof Date
                          ? av.getTime() - bv.getTime()
                          : String(av) < String(bv)
                            ? -1
                            : 1;
                  if (cmp === 0) continue; // equal Dates: fall to the next key
                  return dir === "asc" ? cmp : -cmp;
                }
              }
              return 0;
            });
          }
          if (take !== undefined) rows = rows.slice(0, take);
          return rows;
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const now = new Date();
          const row = {
            id: `act_new_${state.rows.length + 1}`,
            branchId: null,
            snoozeUntil: null,
            dismissedAt: null,
            doneAt: null,
            expiresAt: null,
            createdAt: now,
            surfacedAt: now,
            ...(data as Partial<ActionRow>),
            updatedAt: now,
          } as ActionRow;
          state.rows.push(row);
          return row;
        }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const idx = state.rows.findIndex((r) => r.id === where.id);
          if (idx < 0) throw new Error("not found");
          const next: ActionRow = {
            ...state.rows[idx]!,
            ...(data as Partial<ActionRow>),
            updatedAt: new Date(),
          };
          state.rows[idx] = next;
          return next;
        },
      ),
    },
    auditLog: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { action: string; entityId: string | null; meta: unknown };
        }) => {
          state.audits.push({
            action: data.action,
            entityId: data.entityId ?? null,
            meta: data.meta,
          });
          return { id: `a_${state.audits.length}` };
        },
      ),
    },
  },
}));

// ----- helpers ------------------------------------------------------------

function makeRow(overrides: Partial<ActionRow> = {}): ActionRow {
  const now = new Date("2026-05-06T10:00:00.000Z");
  return {
    id: `act_${Math.random().toString(36).slice(2, 8)}`,
    clinicId: "c1",
    branchId: null,
    type: "EMPTY_SLOT_TOMORROW",
    severity: "high",
    payload: { type: "EMPTY_SLOT_TOMORROW", doctorId: "doc_1" },
    status: "OPEN",
    assigneeRole: "RECEPTIONIST",
    deeplinkPath: "/crm/calendar",
    dedupeKey: `EMPTY_SLOT_TOMORROW:doctorId=doc_1:slotStart=2026-05-07T10:00`,
    snoozeUntil: null,
    dismissedAt: null,
    doneAt: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    surfacedAt: overrides.createdAt ?? now,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  state.rows = [];
  state.audits = [];
  sessionRef.current = {
    user: {
      id: "u_admin",
      role: "ADMIN",
      clinicId: "c1",
      email: "admin@example.test",
    },
  };
});

async function loadRoute(path: string) {
  vi.resetModules();
  return await import(path);
}

function postReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function getReq(url: string): Request {
  return new Request(url);
}

// ----- snooze --------------------------------------------------------------

describe("POST /api/crm/actions/[id]/snooze", () => {
  it("sets snoozeUntil + status SNOOZED + audit when given an explicit until", async () => {
    const row = makeRow();
    state.rows.push(row);
    const mod = await loadRoute("@/app/api/crm/actions/[id]/snooze/route");

    const until = "2026-05-06T12:00:00.000Z";
    const res = await mod.POST(
      postReq(`https://x/api/crm/actions/${row.id}/snooze`, { until }),
    );
    expect(res.status).toBe(200);

    const updated = state.rows.find((r) => r.id === row.id)!;
    expect(updated.status).toBe("SNOOZED");
    expect(updated.snoozeUntil?.toISOString()).toBe(until);

    const aud = state.audits.find((a) => a.action === "ACTION_SNOOZED");
    expect(aud).toBeDefined();
    expect(aud?.entityId).toBe(row.id);
    const meta = aud?.meta as { snoozeUntil: string; oldStatus: string; newStatus: string };
    expect(meta.snoozeUntil).toBe(until);
    expect(meta.oldStatus).toBe("OPEN");
    expect(meta.newStatus).toBe("SNOOZED");
  });

  it("resolves preset='1h' to ~1 hour from now", async () => {
    const row = makeRow();
    state.rows.push(row);
    const mod = await loadRoute("@/app/api/crm/actions/[id]/snooze/route");

    const before = Date.now();
    const res = await mod.POST(
      postReq(`https://x/api/crm/actions/${row.id}/snooze`, { preset: "1h" }),
    );
    expect(res.status).toBe(200);

    const updated = state.rows.find((r) => r.id === row.id)!;
    expect(updated.snoozeUntil).toBeTruthy();
    const delta = updated.snoozeUntil!.getTime() - before;
    // Allow a 5-second slack window; should be ~3_600_000.
    expect(delta).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5000);
    expect(delta).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
  });

  it("rejects body with neither until nor preset (validation error)", async () => {
    const row = makeRow();
    state.rows.push(row);
    const mod = await loadRoute("@/app/api/crm/actions/[id]/snooze/route");
    const res = await mod.POST(
      postReq(`https://x/api/crm/actions/${row.id}/snooze`, {}),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown action id", async () => {
    const mod = await loadRoute("@/app/api/crm/actions/[id]/snooze/route");
    const res = await mod.POST(
      postReq("https://x/api/crm/actions/unknown/snooze", {
        until: "2026-05-06T12:00:00.000Z",
      }),
    );
    expect(res.status).toBe(404);
  });
});

// ----- dismiss -------------------------------------------------------------

describe("POST /api/crm/actions/[id]/dismiss", () => {
  it("sets dismissedAt + status DISMISSED + audit", async () => {
    const row = makeRow();
    state.rows.push(row);
    const mod = await loadRoute("@/app/api/crm/actions/[id]/dismiss/route");

    const res = await mod.POST(
      postReq(`https://x/api/crm/actions/${row.id}/dismiss`, {
        reason: "Not relevant for our clinic right now",
      }),
    );
    expect(res.status).toBe(200);

    const updated = state.rows.find((r) => r.id === row.id)!;
    expect(updated.status).toBe("DISMISSED");
    expect(updated.dismissedAt).toBeInstanceOf(Date);

    const aud = state.audits.find((a) => a.action === "ACTION_DISMISSED");
    expect(aud).toBeDefined();
    const meta = aud?.meta as { reason: string | null; oldStatus: string; newStatus: string };
    expect(meta.reason).toBe("Not relevant for our clinic right now");
    expect(meta.oldStatus).toBe("OPEN");
    expect(meta.newStatus).toBe("DISMISSED");
  });
});

// ----- done ----------------------------------------------------------------

describe("POST /api/crm/actions/[id]/done", () => {
  it("sets doneAt + status DONE + audit", async () => {
    const row = makeRow();
    state.rows.push(row);
    const mod = await loadRoute("@/app/api/crm/actions/[id]/done/route");

    const res = await mod.POST(
      postReq(`https://x/api/crm/actions/${row.id}/done`, {}),
    );
    expect(res.status).toBe(200);

    const updated = state.rows.find((r) => r.id === row.id)!;
    expect(updated.status).toBe("DONE");
    expect(updated.doneAt).toBeInstanceOf(Date);

    const aud = state.audits.find((a) => a.action === "ACTION_DONE");
    expect(aud).toBeDefined();
    const meta = aud?.meta as { oldStatus: string; newStatus: string };
    expect(meta.oldStatus).toBe("OPEN");
    expect(meta.newStatus).toBe("DONE");
  });
});

// ----- reopen --------------------------------------------------------------

describe("POST /api/crm/actions/[id]/reopen", () => {
  it("ADMIN can reopen a DONE action → status OPEN + audit", async () => {
    const row = makeRow({ status: "DONE", doneAt: new Date() });
    state.rows.push(row);
    const mod = await loadRoute("@/app/api/crm/actions/[id]/reopen/route");

    const res = await mod.POST(
      postReq(`https://x/api/crm/actions/${row.id}/reopen`, {}),
    );
    expect(res.status).toBe(200);

    const updated = state.rows.find((r) => r.id === row.id)!;
    expect(updated.status).toBe("OPEN");
    expect(updated.doneAt).toBeNull();

    expect(state.audits.some((a) => a.action === "ACTION_REOPENED")).toBe(true);
  });

  it("RECEPTIONIST gets 403 (admin-only)", async () => {
    sessionRef.current = {
      user: {
        id: "u_recept",
        role: "RECEPTIONIST",
        clinicId: "c1",
        email: "recept@example.test",
      },
    };
    const row = makeRow({ status: "DONE", doneAt: new Date() });
    state.rows.push(row);
    const mod = await loadRoute("@/app/api/crm/actions/[id]/reopen/route");

    const res = await mod.POST(
      postReq(`https://x/api/crm/actions/${row.id}/reopen`, {}),
    );
    expect(res.status).toBe(403);

    const updated = state.rows.find((r) => r.id === row.id)!;
    expect(updated.status).toBe("DONE"); // unchanged
  });
});

// ----- list ----------------------------------------------------------------

describe("GET /api/crm/actions (list)", () => {
  it("filters by status — default to OPEN+SNOOZED", async () => {
    state.rows = [
      makeRow({ id: "a1", status: "OPEN" }),
      makeRow({ id: "a2", status: "DONE", doneAt: new Date() }),
      makeRow({ id: "a3", status: "DISMISSED", dismissedAt: new Date() }),
    ];
    const mod = await loadRoute("@/app/api/crm/actions/route");
    const res = await mod.GET(getReq("https://x/api/crm/actions"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: ActionRow[] };
    const ids = body.rows.map((r) => r.id);
    expect(ids).toContain("a1");
    expect(ids).not.toContain("a2");
    expect(ids).not.toContain("a3");
  });

  it("filters by explicit status=DISMISSED", async () => {
    state.rows = [
      makeRow({ id: "a1", status: "OPEN" }),
      makeRow({ id: "a2", status: "DISMISSED", dismissedAt: new Date() }),
    ];
    const mod = await loadRoute("@/app/api/crm/actions/route");
    const res = await mod.GET(
      getReq("https://x/api/crm/actions?status=DISMISSED"),
    );
    const body = (await res.json()) as { rows: ActionRow[] };
    const ids = body.rows.map((r) => r.id);
    expect(ids).toEqual(["a2"]);
  });

  it("filters by severity", async () => {
    state.rows = [
      makeRow({ id: "a1", severity: "low" }),
      makeRow({ id: "a2", severity: "high" }),
      makeRow({ id: "a3", severity: "critical" }),
    ];
    const mod = await loadRoute("@/app/api/crm/actions/route");
    const res = await mod.GET(
      getReq("https://x/api/crm/actions?severity=critical&severity=high"),
    );
    const body = (await res.json()) as { rows: ActionRow[] };
    const ids = body.rows.map((r) => r.id).sort();
    expect(ids).toEqual(["a2", "a3"]);
  });

  it("filters by type", async () => {
    state.rows = [
      makeRow({ id: "a1", type: "EMPTY_SLOT_TOMORROW" }),
      makeRow({ id: "a2", type: "PAYMENT_OVERDUE" }),
    ];
    const mod = await loadRoute("@/app/api/crm/actions/route");
    const res = await mod.GET(
      getReq("https://x/api/crm/actions?type=PAYMENT_OVERDUE"),
    );
    const body = (await res.json()) as { rows: ActionRow[] };
    const ids = body.rows.map((r) => r.id);
    expect(ids).toEqual(["a2"]);
  });

  it("hides actively snoozed rows (snoozeUntil > now)", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 60 * 1000);
    state.rows = [
      makeRow({ id: "a1", status: "OPEN" }),
      makeRow({ id: "a2", status: "SNOOZED", snoozeUntil: future }),
      makeRow({ id: "a3", status: "SNOOZED", snoozeUntil: past }),
    ];
    const mod = await loadRoute("@/app/api/crm/actions/route");
    const res = await mod.GET(getReq("https://x/api/crm/actions"));
    const body = (await res.json()) as { rows: ActionRow[] };
    const ids = body.rows.map((r) => r.id).sort();
    // a2 hidden; a3's snooze elapsed so it resurfaces.
    expect(ids).toEqual(["a1", "a3"]);
  });

  it("excludes rows with status='EXPIRED' and rows with elapsed expiresAt", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 60 * 1000);
    state.rows = [
      makeRow({ id: "a1", status: "OPEN" }),
      makeRow({ id: "a2", status: "EXPIRED" }),
      makeRow({ id: "a3", status: "OPEN", expiresAt: past }),
      makeRow({ id: "a4", status: "OPEN", expiresAt: future }),
    ];
    const mod = await loadRoute("@/app/api/crm/actions/route");
    const res = await mod.GET(getReq("https://x/api/crm/actions"));
    const body = (await res.json()) as { rows: ActionRow[] };
    const ids = body.rows.map((r) => r.id).sort();
    expect(ids).toEqual(["a1", "a4"]);
  });

  it("filters by assigneeRole and includes null-assignee rows", async () => {
    state.rows = [
      makeRow({ id: "a1", assigneeRole: "RECEPTIONIST" }),
      makeRow({ id: "a2", assigneeRole: "ADMIN" }),
      makeRow({ id: "a3", assigneeRole: null }),
    ];
    const mod = await loadRoute("@/app/api/crm/actions/route");
    const res = await mod.GET(
      getReq("https://x/api/crm/actions?assigneeRole=RECEPTIONIST"),
    );
    const body = (await res.json()) as { rows: ActionRow[] };
    const ids = body.rows.map((r) => r.id).sort();
    expect(ids).toEqual(["a1", "a3"]);
  });
});

// ----- list order: severity, then surfacedAt, before the limit -------------
//
// Review of AC-01 / AC-03: a snoozed or scheduled row resurfaced with its
// original createdAt, and the list took the newest N by createdAt before the
// severity sort. The briefing (limit=5) and the Action Center (limit=50, no
// «load more») therefore never showed a control-visit call or a «1 час»
// snooze once enough newer rows existed.

describe("GET /api/crm/actions (order)", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  async function list(qs = ""): Promise<{ rows: ActionRow[]; nextCursor: string | null }> {
    const mod = await loadRoute("@/app/api/crm/actions/route");
    const res = await mod.GET(getReq(`https://x/api/crm/actions${qs}`));
    expect(res.status).toBe(200);
    return (await res.json()) as { rows: ActionRow[]; nextCursor: string | null };
  }

  /** `n` medium rows created (and surfaced) in the hours before `now`. */
  function freshMediums(now: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const at = new Date(now - (i + 1) * HOUR);
      state.rows.push(
        makeRow({
          id: `fresh_${i}`,
          type: "UNCONFIRMED_24H",
          severity: "medium",
          dedupeKey: `UNCONFIRMED_24H:appointmentId=ap_${i}`,
          createdAt: at,
          updatedAt: at,
          surfacedAt: at,
        }),
      );
    }
  }

  it("a control-visit call scheduled on finalize leads the briefing on its surface day", async () => {
    // 01.09, 11:00 Tashkent: the doctor finalizes with followUpDays=30.
    const finalized = new Date("2026-09-01T06:00:00.000Z");
    vi.useFakeTimers({ now: finalized, toFake: ["Date"] });
    const { upsertAction } = await import("@/server/actions/repository");
    const { prisma } = await import("@/lib/prisma");
    const surfaceAt = new Date("2026-09-24T04:00:00.000Z"); // 24.09 09:00
    const { id } = await upsertAction(
      prisma as never,
      "c1",
      {
        type: "VISIT_FOLLOW_UP_DUE",
        visitNoteId: "vn_1",
        patientId: "p_1",
        patientName: "Иванова Мария",
        doctorId: "doc_1",
        doctorName: "Алиев А.А.",
        dueDate: "2026-10-01",
        followUpNote: "",
      },
      { surfaceAt, expiresAt: new Date("2026-10-08T00:00:00.000Z") },
    );
    const row = state.rows.find((r) => r.id === id)!;
    expect(row.status).toBe("SNOOZED");
    expect(row.createdAt).toEqual(finalized);
    expect(row.surfacedAt).toEqual(surfaceAt);

    // 24.09 10:00: plenty of rows were created in the 23 days since.
    const now = surfaceAt.getTime() + HOUR;
    vi.setSystemTime(now);
    freshMediums(now - HOUR, 8);

    const briefing = await list("?status=OPEN&status=SNOOZED&limit=5");
    expect(briefing.rows.map((r) => r.id)[0]).toBe(id);
    expect(briefing.rows).toHaveLength(5);
  });

  it("«Отложить на 1 час» brings the task back at the top of its severity", async () => {
    const now = new Date("2026-09-25T06:00:00.000Z").getTime();
    vi.useFakeTimers({ now, toFake: ["Date"] });
    const old = new Date(now - 3 * DAY);
    state.rows.push(
      makeRow({
        id: "debt",
        type: "PAYMENT_OVERDUE",
        severity: "medium",
        dedupeKey: "PAYMENT_OVERDUE:appointmentId=ap_debt",
        createdAt: old,
        updatedAt: old,
        surfacedAt: old,
      }),
    );
    const snooze = await loadRoute("@/app/api/crm/actions/[id]/snooze/route");
    const res = await snooze.POST(
      postReq("https://x/api/crm/actions/debt/snooze", { preset: "1h" }),
    );
    expect(res.status).toBe(200);

    // Five newer rows appear while it is hidden.
    freshMediums(now + HOUR, 5);
    expect((await list("?limit=5")).rows.map((r) => r.id)).not.toContain("debt");

    vi.setSystemTime(now + HOUR + 60_000);
    const back = await list("?status=OPEN&status=SNOOZED&limit=5");
    expect(back.rows[0]!.id).toBe("debt");
  });

  it("applies the severity order before the limit", async () => {
    const now = new Date("2026-09-25T06:00:00.000Z").getTime();
    vi.useFakeTimers({ now, toFake: ["Date"] });
    freshMediums(now, 6);
    const old = new Date(now - 10 * DAY);
    state.rows.push(
      makeRow({
        id: "critical_old",
        severity: "critical",
        createdAt: old,
        updatedAt: old,
        surfacedAt: old,
      }),
    );
    const top = await list("?limit=5");
    // The old code took the five newest rows (all medium) and sorted those.
    expect(top.rows[0]!.id).toBe("critical_old");
    expect(top.rows.slice(1).map((r) => r.id)).toEqual([
      "fresh_0",
      "fresh_1",
      "fresh_2",
      "fresh_3",
    ]);
  });

  it("pages through every row exactly once, severity first", async () => {
    const now = new Date("2026-09-25T06:00:00.000Z").getTime();
    vi.useFakeTimers({ now, toFake: ["Date"] });
    const specs: Array<[string, string, number]> = [
      ["c1", "critical", 5],
      ["c2", "critical", 1],
      ["h1", "high", 9],
      ["h2", "high", 2],
      ["h3", "high", 2], // same surfacedAt as h2: the id breaks the tie
      ["m1", "medium", 3],
      ["l1", "low", 1],
    ];
    for (const [id, severity, hoursAgo] of specs) {
      const at = new Date(now - hoursAgo * HOUR);
      state.rows.push(
        makeRow({ id, severity, createdAt: at, updatedAt: at, surfacedAt: at }),
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page = await list(`?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(["c2", "c1", "h3", "h2", "h1", "m1", "l1"]);
  });

  it("keeps its place when the cursor row is closed between pages", async () => {
    const now = new Date("2026-09-25T06:00:00.000Z").getTime();
    vi.useFakeTimers({ now, toFake: ["Date"] });
    freshMediums(now, 4);
    const first = await list("?limit=2");
    expect(first.rows.map((r) => r.id)).toEqual(["fresh_0", "fresh_1"]);
    state.rows.find((r) => r.id === "fresh_1")!.status = "DONE";
    const second = await list(`?limit=2&cursor=${first.nextCursor}`);
    expect(second.rows.map((r) => r.id)).toEqual(["fresh_2", "fresh_3"]);
    expect(second.nextCursor).toBeNull();
  });
});
