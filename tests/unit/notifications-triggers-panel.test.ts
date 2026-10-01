/**
 * Audit TG-25 / TG-16: the «Триггеры» panel matched templates by key against
 * TRIGGER_KEYS while the dispatcher picks by enum + offset / audience, so
 * real cancellation templates read «нужен шаблон» and the timings were
 * hard-coded labels. Rows now come from the event catalog and show the
 * template the dispatcher really sends; an event with no template at all is
 * flagged. The switch acts on the whole event.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({ templates: [] as Array<Record<string, unknown>> }));

function cmp(v: unknown) {
  return v instanceof Date ? v.getTime() : v;
}
function matches(t: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as Row[]).some((w) => matches(t, w));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const e = v as Row;
      if ("path" in e) return ((t[k] ?? {}) as Row)[(e.path as string[])[0]!] === e.equals;
      if ("equals" in e) return JSON.stringify(t[k] ?? null) === JSON.stringify(e.equals);
      if ("in" in e) return (e.in as unknown[]).includes(t[k]);
      if ("not" in e) return t[k] !== e.not;
    }
    return cmp(t[k]) === cmp(v);
  });
}
function newestFirst(rows: Row[]) {
  return [...rows].sort((a, b) => (cmp(b.updatedAt) as number) - (cmp(a.updatedAt) as number));
}

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "ADMIN" };
  return {
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
    createApiHandler:
      (
        opts: { bodySchema: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({ request, body: opts.bodySchema.parse(await request.json()), ctx }),
  };
});
vi.mock("@/lib/prisma", () => {
  const notificationTemplate = {
    findMany: vi.fn(async ({ where }: { where: Row }) =>
      newestFirst(db.templates.filter((t) => matches(t, where))),
    ),
    findFirst: vi.fn(
      async ({ where }: { where: Row }) =>
        newestFirst(db.templates.filter((t) => matches(t, where)))[0] ?? null,
    ),
    findUnique: vi.fn(async ({ where }: { where: Row }) => db.templates.find((t) => t.id === where.id) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `new_${db.templates.length}`, clinicId: "c1", updatedAt: new Date(), ...data };
      db.templates.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const t = db.templates.find((x) => x.id === where.id)!;
      Object.assign(t, data, { updatedAt: new Date() });
      return t;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hit = db.templates.filter((t) => matches(t, where));
      hit.forEach((t) => Object.assign(t, data));
      return { count: hit.length };
    }),
  };
  return {
    prisma: {
      notificationTemplate,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ notificationTemplate })),
    },
  };
});

function tpl(id: string, over: Row): Row {
  return {
    id,
    clinicId: "c1",
    key: id,
    nameRu: id,
    nameUz: id,
    channel: "TG",
    isActive: true,
    triggerConfig: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...over,
  };
}

beforeEach(() => {
  db.templates = [
    tpl("appointment.cancelled.by-staff", { trigger: "APPOINTMENT_CANCELLED", triggerConfig: { audience: "staff" } }),
    tpl("appointment.cancelled.by-patient", { trigger: "APPOINTMENT_CANCELLED", triggerConfig: { audience: "patient" } }),
    tpl("reminder.24h", {
      trigger: "APPOINTMENT_BEFORE",
      triggerConfig: { offsetMin: -1440 },
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    }),
    tpl("appointment.reminder-24h", {
      trigger: "APPOINTMENT_BEFORE",
      triggerConfig: { offsetMin: -1440 },
      updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    }),
    tpl("case.repeat-due", { trigger: "CASE_REPEAT_DUE", triggerConfig: { daysBefore: 3 }, isActive: false }),
  ];
});

async function rows() {
  const { GET } = await import("@/app/api/crm/notifications/triggers/route");
  const res = await GET(new Request("http://x/api/crm/notifications/triggers"));
  return ((await res.json()) as { rows: Array<Row & { template: Row | null }> }).rows;
}

async function toggle(event: string, enabled: boolean) {
  const { PATCH } = await import("@/app/api/crm/notifications/triggers/route");
  return PATCH(
    new Request("http://x/api/crm/notifications/triggers", {
      method: "PATCH",
      body: JSON.stringify({ event, enabled }),
    }),
  );
}

describe("GET /api/crm/notifications/triggers", () => {
  it("shows the template each event really sends, by the dispatcher's own lookup", async () => {
    const byKey = new Map((await rows()).map((r) => [r.key, r]));
    expect(byKey.get("appointment.cancelled.by-staff")).toMatchObject({
      active: true,
      label: "cancelledByStaff",
      template: { key: "appointment.cancelled.by-staff" },
    });
    // The newer of the two 24h duplicates is the one sent.
    expect(byKey.get("appointment.reminder-24h")!.template!.key).toBe("appointment.reminder-24h");
    expect(byKey.get("appointment.reminder-24h")!.timing).toBe("before24h");
  });

  it("flags an event nobody gets and shows a switched-off one with its own timing", async () => {
    const byKey = new Map((await rows()).map((r) => [r.key, r]));
    expect(byKey.get("appointment.running-late")).toMatchObject({ active: false, template: null });
    expect(byKey.get("case.repeat-due")).toMatchObject({
      active: false,
      template: { key: "case.repeat-due", isActive: false },
      timingValues: { days: 3 },
    });
  });
});

describe("PATCH /api/crm/notifications/triggers", () => {
  it("off stops the event, the older duplicate included", async () => {
    expect((await toggle("appointment.reminder-24h", false)).status).toBe(200);
    expect(
      db.templates.filter((t) => String(t.key).includes("24h")).map((t) => t.isActive),
    ).toEqual([false, false]);
    expect((await rows()).find((r) => r.key === "appointment.reminder-24h")!.active).toBe(false);
  });

  it("on switches one template of the event back on", async () => {
    await toggle("appointment.reminder-24h", false);
    await toggle("appointment.reminder-24h", true);
    const on = db.templates.filter((t) => String(t.key).includes("24h") && t.isActive);
    expect(on.map((t) => t.key)).toEqual(["appointment.reminder-24h"]);
  });

  it("answers 409 for an event without any template", async () => {
    expect((await toggle("appointment.running-late", true)).status).toBe(409);
  });
});

describe("template editor routes (TG-25, TG-22)", () => {
  const body = (over: Row) =>
    JSON.stringify({
      key: "my.reminder",
      nameRu: "Напоминание",
      nameUz: "Eslatma",
      channel: "TG",
      category: "REMINDER",
      bodyRu: "Завтра приём",
      bodyUz: "Ertaga qabul",
      ...over,
    });

  it("refuses an EMAIL template: there is no adapter to send it", async () => {
    const { POST } = await import("@/app/api/crm/notifications/templates/route");
    const res = await POST(
      new Request("http://x/api/crm/notifications/templates", { method: "POST", body: body({ channel: "EMAIL" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("a template created for an event is bound to it and takes it over", async () => {
    const { POST } = await import("@/app/api/crm/notifications/templates/route");
    db.templates.push(tpl("old.rescheduled", { trigger: "APPOINTMENT_RESCHEDULED" }));
    const res = await POST(
      new Request("http://x/api/crm/notifications/templates", {
        method: "POST",
        body: body({ trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -1440 } }),
      }),
    );
    expect(res.status).toBe(201);
    const created = db.templates.find((t) => t.key === "my.reminder")!;
    expect(created).toMatchObject({ trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -1440 }, isActive: true });
    // The two 24h templates that held the event are off now.
    expect(
      db.templates.filter((t) => String(t.key).includes("24h")).map((t) => t.isActive),
    ).toEqual([false, false]);
    // Another event is untouched.
    expect(db.templates.find((t) => t.key === "old.rescheduled")!.isActive).toBe(true);
  });

  it("a PATCH that only switches a template keeps its event", async () => {
    const { PATCH } = await import("@/app/api/crm/notifications/templates/[id]/route");
    const res = await PATCH(
      new Request("http://x/api/crm/notifications/templates/reminder.24h", {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      }),
    );
    expect(res.status).toBe(200);
    const t = db.templates.find((x) => x.id === "reminder.24h")!;
    expect(t.trigger).toBe("APPOINTMENT_BEFORE");
    // Switched on, it is the event's only active template.
    expect(db.templates.find((x) => x.id === "appointment.reminder-24h")!.isActive).toBe(false);
  });
});
