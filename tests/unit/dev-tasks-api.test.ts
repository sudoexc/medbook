/**
 * «Задачи» board API (`/api/crm/dev-tasks`): the rules as the routes enforce
 * them, run against an in-memory Prisma that scopes rows by the tenant
 * context exactly as the real extension does (pinned separately in
 * dev-tasks-tenant.test.ts).
 *
 *   - numbering: «#N» per clinic, allocated in the create transaction;
 *   - who may file, edit and comment; only ADMIN / SUPER_ADMIN move columns,
 *     along the allowed transitions, conditional on the column read;
 *   - tenant isolation: another clinic's task, comment or screenshot is a 404;
 *   - screenshots: images by their bytes only, 10 MB each, 20 per task,
 *     stored in the task's own folder and streamed with safe headers;
 *   - audit rows for create and status change, without free text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string; clinicId: string };

const db = vi.hoisted(() => ({
  clinics: new Map<string, { id: string; devTaskCounter: number }>(),
  users: new Map<string, { id: string; name: string; role: string }>(),
  tasks: [] as Row[],
  comments: [] as Row[],
  attachments: [] as Row[],
  objects: new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>(),
  audits: [] as Array<{ action: string; entityType: string; entityId?: string | null; meta?: unknown }>,
  transactions: 0,
  seq: 0,
  clock: Date.parse("2026-10-03T08:00:00Z"),
  raceUpdate: false,
}));

const session = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; clinicId: string | null; email: string },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (session.user ? { user: session.user } : null)),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: Request, input: (typeof db.audits)[number]) => {
    db.audits.push(input);
  }),
}));
vi.mock("@/server/storage/minio", () => ({
  uploadObject: vi.fn(async (_b: unknown, key: string, body: Buffer, contentType: string) => {
    db.objects.set(key, { bytes: new Uint8Array(body), contentType });
    return { key, url: `file:///tmp/${key}` };
  }),
  deleteObject: vi.fn(async (_b: unknown, key: string) => {
    db.objects.delete(key);
  }),
  fetchObject: vi.fn(async (_b: unknown, key: string) => {
    const o = db.objects.get(key);
    if (!o) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    // Like stub mode: storage does not know the real type.
    return {
      body: new Response(o.bytes).body,
      contentType: "application/octet-stream",
      contentLength: o.bytes.byteLength,
    };
  }),
}));

vi.mock("@/lib/prisma", async () => {
  const { getTenant } = await import("@/lib/tenant-context");
  const now = () => new Date((db.clock += 1000));

  // The tenant extension's effect: a TENANT context sees its clinic only.
  const scoped = (rows: Row[]) => {
    const ctx = getTenant();
    if (!ctx) throw new Error("no tenant context");
    return ctx.kind === "TENANT" ? rows.filter((r) => r.clinicId === ctx.clinicId) : rows;
  };
  const stamp = (data: Record<string, unknown>) => {
    const ctx = getTenant();
    return { clinicId: ctx?.kind === "TENANT" ? ctx.clinicId : undefined, ...data };
  };
  const matches = (row: Row, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === "object" && "in" in (v as object)
        ? ((v as { in: unknown[] }).in).includes(row[k])
        : row[k] === v,
    );
  const person = (id: unknown) => {
    const u = db.users.get(String(id))!;
    return { id: u.id, name: u.name, role: u.role };
  };
  const byCreated = (a: Row, b: Row) =>
    (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime();
  const hydrateTask = (t: Row) => {
    const atts = db.attachments.filter((a) => a.taskId === t.id).sort(byCreated);
    const coms = db.comments.filter((c) => c.taskId === t.id).sort(byCreated);
    return {
      ...t,
      createdBy: person(t.createdById),
      _count: { comments: coms.length, attachments: atts.length },
      attachments: atts.map((a) => ({ ...a, uploadedBy: person(a.uploadedById) })),
      comments: coms.map((c) => ({ ...c, author: person(c.authorId) })),
    };
  };

  const prisma = {
    clinic: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { devTaskCounter: { increment: number } } }) => {
        const c = db.clinics.get(where.id)!;
        c.devTaskCounter += data.devTaskCounter.increment;
        return { devTaskCounter: c.devTaskCounter };
      }),
    },
    devTask: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const row = scoped(db.tasks).find((t) => matches(t, where));
        return row ? hydrateTask(row) : null;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        scoped(db.tasks).filter((t) => matches(t, where)).map(hydrateTask),
      ),
      groupBy: vi.fn(async () => {
        const counts = new Map<string, number>();
        for (const t of scoped(db.tasks)) counts.set(String(t.status), (counts.get(String(t.status)) ?? 0) + 1);
        return [...counts].map(([status, n]) => ({ status, _count: { _all: n } }));
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        scoped(db.tasks).filter((t) => matches(t, where)).length,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `task${++db.seq}xxxxxxxx`,
          description: "",
          status: "NEW",
          priority: "NORMAL",
          startedAt: null,
          doneAt: null,
          createdAt: now(),
          updatedAt: now(),
          ...stamp(data),
        } as Row;
        // The (clinicId, number) unique index.
        if (db.tasks.some((t) => t.clinicId === row.clinicId && t.number === row.number)) {
          throw new Error("Unique constraint failed on (clinicId, number)");
        }
        db.tasks.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = scoped(db.tasks).find((t) => matches(t, where))!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (db.raceUpdate) return { count: 0 };
        const rows = scoped(db.tasks).filter((t) => matches(t, where));
        for (const r of rows) Object.assign(r, data, { updatedAt: now() });
        return { count: rows.length };
      }),
    },
    devTaskComment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `com${++db.seq}`, createdAt: now(), ...stamp(data) } as Row;
        db.comments.push(row);
        return row;
      }),
    },
    devTaskAttachment: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        scoped(db.attachments).filter((a) => matches(a, where)).length,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `att${++db.seq}`, createdAt: now(), ...stamp(data) } as Row;
        db.attachments.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const row = scoped(db.attachments).find((a) => matches(a, where));
        if (!row) return null;
        const task = db.tasks.find((t) => t.id === row.taskId)!;
        return { ...row, task: { id: task.id, number: task.number, createdById: task.createdById } };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const gone = scoped(db.attachments).filter((a) => matches(a, where));
        db.attachments = db.attachments.filter((a) => !gone.includes(a));
        return { count: gone.length };
      }),
    },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => {
      db.transactions += 1;
      return fn(prisma);
    }),
  };
  return { prisma };
});

import { AUDIT_ACTION } from "@/lib/audit-actions";
import { DEV_TASK_MAX_ATTACHMENTS, DEV_TASK_MAX_BYTES } from "@/lib/dev-tasks";

const USERS = {
  admin: { id: "u_admin", name: "Султонов М.", role: "ADMIN", clinicId: "c1" },
  desk: { id: "u_desk", name: "Ресепшн", role: "RECEPTIONIST", clinicId: "c1" },
  doc: { id: "u_doc", name: "Азиз", role: "DOCTOR", clinicId: "c1" },
  doc2: { id: "u_doc2", name: "Другой врач", role: "DOCTOR", clinicId: "c1" },
  nurse: { id: "u_nurse", name: "Медсестра", role: "NURSE", clinicId: "c1" },
  sa: { id: "u_sa", name: "Javohir", role: "SUPER_ADMIN", clinicId: "c1" },
  other: { id: "u_other", name: "Чужой админ", role: "ADMIN", clinicId: "c2" },
} as const;

function as(user: keyof typeof USERS, clinicId?: string | null) {
  const u = USERS[user];
  session.user = {
    id: u.id,
    role: u.role,
    clinicId: clinicId === undefined ? u.clinicId : clinicId,
    email: `${u.id}@x.t`,
  };
}

const BASE = "https://neurofax.uz/api/crm/dev-tasks";

function jsonReq(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createTask(body: Record<string, unknown> = { title: "Не печатается заключение" }) {
  const { POST } = await import("@/app/api/crm/dev-tasks/route");
  return POST(jsonReq(BASE, "POST", body));
}

async function patchTask(ref: string, body: Record<string, unknown>) {
  const { PATCH } = await import("@/app/api/crm/dev-tasks/[id]/route");
  return PATCH(jsonReq(`${BASE}/${ref}`, "PATCH", body));
}

async function getTask(ref: string) {
  const { GET } = await import("@/app/api/crm/dev-tasks/[id]/route");
  return GET(new Request(`${BASE}/${ref}`));
}

function seedTask(over: Partial<Row> = {}): Row {
  const row = {
    id: `seed${++db.seq}xxxxxxxx`,
    clinicId: "c1",
    number: 0,
    title: "Кнопка не работает",
    description: "",
    status: "NEW",
    priority: "NORMAL",
    createdById: "u_doc",
    createdAt: new Date((db.clock += 1000)),
    updatedAt: new Date(db.clock),
    startedAt: null,
    doneAt: null,
    ...over,
  } as Row;
  if (!row.number) {
    const c = db.clinics.get(row.clinicId)!;
    c.devTaskCounter += 1;
    row.number = c.devTaskCounter;
  }
  db.tasks.push(row);
  return row;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 2, 3]);

async function upload(
  ref: string,
  file: { bytes: Uint8Array<ArrayBuffer>; name: string; type: string },
  thumb?: { bytes: Uint8Array<ArrayBuffer>; type: string },
) {
  const form = new FormData();
  form.append("file", new File([file.bytes], file.name, { type: file.type }));
  if (thumb) form.append("thumb", new File([thumb.bytes], "thumb.jpg", { type: thumb.type }));
  const { POST } = await import("@/app/api/crm/dev-tasks/[id]/attachments/route");
  return POST(new Request(`${BASE}/${ref}/attachments`, { method: "POST", body: form }));
}

beforeEach(() => {
  db.clinics = new Map([
    ["c1", { id: "c1", devTaskCounter: 0 }],
    ["c2", { id: "c2", devTaskCounter: 0 }],
  ]);
  db.users = new Map(Object.values(USERS).map((u) => [u.id, { id: u.id, name: u.name, role: u.role }]));
  db.tasks = [];
  db.comments = [];
  db.attachments = [];
  db.objects = new Map();
  db.audits = [];
  db.transactions = 0;
  db.raceUpdate = false;
  // Fresh rate-limit windows for every test (the stores live on globalThis).
  (globalThis as unknown as Record<symbol, Map<string, unknown> | undefined>)[
    Symbol.for("medbook.rate-limit.stores")
  ]?.clear();
  as("admin");
});

describe("filing a task and its «#N»", () => {
  it("numbers per clinic inside the create transaction: #1, #2 here, #1 again in another clinic", async () => {
    const first = await createTask();
    const second = await createTask({ title: "Второе", priority: "URGENT" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(((await first.json()) as { number: number }).number).toBe(1);
    const body = (await second.json()) as { number: number; priority: string; status: string };
    expect(body).toMatchObject({ number: 2, priority: "URGENT", status: "NEW" });
    expect(db.transactions).toBe(2);

    as("other");
    const elsewhere = await createTask();
    expect(((await elsewhere.json()) as { number: number }).number).toBe(1);
    expect(db.tasks.map((t) => [t.clinicId, t.number])).toEqual([
      ["c1", 1],
      ["c1", 2],
      ["c2", 1],
    ]);
  });

  it("audits the creation with the number and priority, never the text", async () => {
    await createTask({ title: "Пациент Иванов не находится", description: "Иванов И. И." });
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({
      action: AUDIT_ACTION.DEV_TASK_CREATED,
      entityType: "DevTask",
      meta: { number: 1, priority: "NORMAL" },
    });
    expect(JSON.stringify(db.audits[0])).not.toContain("Иванов");
  });

  it("the desk and doctors file tasks; nurses and call operators do not", async () => {
    as("desk");
    expect((await createTask()).status).toBe(201);
    as("doc");
    expect((await createTask()).status).toBe(201);
    as("nurse");
    expect((await createTask()).status).toBe(403);
    session.user = { id: "u_op", role: "CALL_OPERATOR", clinicId: "c1", email: "op@x.t" };
    expect((await createTask()).status).toBe(403);
  });

  it("SUPER_ADMIN files inside a clinic, and is told to enter one outside it", async () => {
    as("sa");
    expect((await createTask()).status).toBe(201);
    as("sa", null);
    const res = await createTask();
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("ClinicNotSelected");
  });

  it("refuses an empty title", async () => {
    expect((await createTask({ title: "   " })).status).toBe(400);
    expect(db.tasks).toHaveLength(0);
  });

  it("stops a runaway client after 30 tasks an hour", async () => {
    for (let i = 0; i < 30; i += 1) expect((await createTask()).status).toBe(201);
    const res = await createTask();
    expect(res.status).toBe(429);
    expect(((await res.json()) as { reason: string }).reason).toBe("dev_task_rate_limited");
    expect(db.tasks).toHaveLength(30);
  });

  it("the board lists the clinic's tasks with real per-column counts; nurses get 403", async () => {
    seedTask({ status: "NEW" });
    seedTask({ status: "IN_PROGRESS" });
    seedTask({ status: "CANCELLED" });
    const { GET } = await import("@/app/api/crm/dev-tasks/route");
    const res = await GET(new Request(BASE));
    const body = (await res.json()) as { rows: Array<{ status: string }>; counts: Record<string, number> };
    expect(body.rows.map((r) => r.status).sort()).toEqual(["IN_PROGRESS", "NEW"]);
    expect(body.counts).toEqual({ NEW: 1, IN_PROGRESS: 1, DONE: 0, CANCELLED: 1 });
    const withCancelled = (await (await GET(new Request(`${BASE}?includeCancelled=1`))).json()) as {
      rows: unknown[];
    };
    expect(withCancelled.rows).toHaveLength(3);

    const { GET: summary } = await import("@/app/api/crm/dev-tasks/summary/route");
    expect(await (await summary(new Request(`${BASE}/summary`))).json()).toEqual({ open: 2 });

    as("nurse");
    expect((await GET(new Request(BASE))).status).toBe(403);
  });
});

describe("who moves a task between columns", () => {
  it("the author doctor and the desk cannot change the status", async () => {
    const task = seedTask({ createdById: "u_doc" });
    as("doc");
    const res = await patchTask(String(task.number), { status: "DONE" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reason: string }).reason).toBe("dev_task_status_admin_only");
    as("desk");
    expect((await patchTask(String(task.number), { status: "IN_PROGRESS" })).status).toBe(403);
    expect(task.status).toBe("NEW");
    expect(db.audits).toHaveLength(0);
  });

  it("ADMIN takes it into work: status, start time and an audit row", async () => {
    const task = seedTask();
    const res = await patchTask(String(task.number), { status: "IN_PROGRESS" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; startedAt: string | null; allowedStatuses: string[] };
    expect(body.status).toBe("IN_PROGRESS");
    expect(body.startedAt).not.toBeNull();
    expect(body.allowedStatuses).toEqual(["DONE", "CANCELLED", "NEW"]);
    expect(db.audits).toEqual([
      expect.objectContaining({
        action: AUDIT_ACTION.DEV_TASK_STATUS_CHANGED,
        entityId: task.id,
        meta: { number: task.number, from: "NEW", to: "IN_PROGRESS" },
      }),
    ]);
  });

  it("SUPER_ADMIN inside the clinic finishes it, by id as well as by number", async () => {
    as("sa");
    const task = seedTask({ status: "IN_PROGRESS", startedAt: new Date("2026-10-02T10:00:00Z") });
    const res = await patchTask(task.id, { status: "DONE" });
    expect(res.status).toBe(200);
    expect(task.status).toBe("DONE");
    expect(task.doneAt).toBeInstanceOf(Date);
    expect((task.startedAt as Date).toISOString()).toBe("2026-10-02T10:00:00.000Z");
  });

  it("refuses a move the board has no button for", async () => {
    const task = seedTask({ status: "DONE", doneAt: new Date() });
    const res = await patchTask(String(task.number), { status: "IN_PROGRESS" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("transition_not_allowed");
    expect(task.status).toBe("DONE");
  });

  it("the same status again is a quiet no-op (a double tap on a phone)", async () => {
    const task = seedTask({ status: "IN_PROGRESS" });
    expect((await patchTask(String(task.number), { status: "IN_PROGRESS" })).status).toBe(200);
    expect(db.audits).toHaveLength(0);
  });

  it("loses the race cleanly when someone moved it meanwhile", async () => {
    const task = seedTask();
    db.raceUpdate = true;
    const res = await patchTask(String(task.number), { status: "IN_PROGRESS" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("dev_task_status_changed");
    expect(db.audits).toHaveLength(0);
  });
});

describe("who edits the text", () => {
  it("the author edits his own task; another doctor cannot; ADMIN can", async () => {
    const task = seedTask({ createdById: "u_doc", title: "Старый" });
    as("doc2");
    const denied = await patchTask(String(task.number), { title: "Чужая правка" });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { reason: string }).reason).toBe("dev_task_author_only");
    expect(task.title).toBe("Старый");

    as("doc");
    expect((await patchTask(String(task.number), { title: "Новый", priority: "HIGH" })).status).toBe(200);
    expect(task).toMatchObject({ title: "Новый", priority: "HIGH" });
    expect(db.audits.at(-1)).toMatchObject({
      action: AUDIT_ACTION.DEV_TASK_UPDATED,
      meta: { number: task.number, fields: ["title", "priority"], priority: "HIGH" },
    });

    as("admin");
    expect((await patchTask(String(task.number), { description: "Уточнение" })).status).toBe(200);
    expect(task.description).toBe("Уточнение");
  });

  it("tells each viewer what he may do", async () => {
    const task = seedTask({ createdById: "u_doc" });
    as("doc2");
    const forDoctor = (await (await getTask(String(task.number))).json()) as {
      can: Record<string, boolean>;
      allowedStatuses: string[];
    };
    expect(forDoctor.can).toEqual({ edit: false, manage: false, comment: true });
    expect(forDoctor.allowedStatuses).toEqual([]);
    as("admin");
    const forAdmin = (await (await getTask(String(task.number))).json()) as typeof forDoctor;
    expect(forAdmin.can).toEqual({ edit: true, manage: true, comment: true });
    expect(forAdmin.allowedStatuses).toEqual(["IN_PROGRESS", "DONE", "CANCELLED"]);
  });
});

describe("tenant isolation", () => {
  it("another clinic's task is not found by id or by its number, and cannot be changed", async () => {
    const foreign = seedTask({ clinicId: "c2", createdById: "u_other" });
    expect((await getTask(foreign.id)).status).toBe(404);
    expect((await getTask(String(foreign.number))).status).toBe(404);
    expect((await patchTask(foreign.id, { status: "CANCELLED" })).status).toBe(404);
    expect(foreign.status).toBe("NEW");

    const { POST } = await import("@/app/api/crm/dev-tasks/[id]/comments/route");
    const res = await POST(jsonReq(`${BASE}/${foreign.id}/comments`, "POST", { text: "чужое" }));
    expect(res.status).toBe(404);
    expect(db.comments).toHaveLength(0);

    expect((await upload(foreign.id, { bytes: PNG, name: "s.png", type: "image/png" })).status).toBe(404);

    const { GET } = await import("@/app/api/crm/dev-tasks/route");
    const board = (await (await GET(new Request(BASE))).json()) as { rows: unknown[] };
    expect(board.rows).toHaveLength(0);
  });

  it("another clinic's screenshot is not streamed, even with its ids in the URL", async () => {
    const foreign = seedTask({ clinicId: "c2", createdById: "u_other" });
    const key = `clinics/c2/dev-tasks/${foreign.id}/a.png`;
    db.objects.set(key, { bytes: PNG, contentType: "image/png" });
    db.attachments.push({
      id: "attforeign",
      clinicId: "c2",
      taskId: foreign.id,
      objectKey: key,
      thumbKey: null,
      mimeType: "image/png",
      sizeBytes: PNG.byteLength,
      uploadedById: "u_other",
      createdAt: new Date(),
    });
    const { GET } = await import("@/app/api/crm/dev-tasks/[id]/attachments/[attachmentId]/route");
    const res = await GET(new Request(`${BASE}/${foreign.id}/attachments/attforeign`));
    expect(res.status).toBe(404);
  });
});

describe("comments", () => {
  it("anyone on the board replies, the thread comes back, the task's activity moves", async () => {
    const task = seedTask({ createdById: "u_doc", updatedAt: new Date("2026-01-01T00:00:00Z") });
    const before = (task.updatedAt as Date).getTime();
    as("doc2");
    const { POST } = await import("@/app/api/crm/dev-tasks/[id]/comments/route");
    const res = await POST(jsonReq(`${BASE}/${task.number}/comments`, "POST", { text: "У меня тоже" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { comments: Array<{ text: string; author: { name: string } }> };
    expect(body.comments).toEqual([expect.objectContaining({ text: "У меня тоже", author: expect.objectContaining({ name: "Другой врач" }) })]);
    expect((task.updatedAt as Date).getTime()).toBeGreaterThan(before);
    expect(db.audits.at(-1)).toMatchObject({ action: AUDIT_ACTION.DEV_TASK_COMMENTED, meta: { number: task.number } });

    expect((await POST(jsonReq(`${BASE}/${task.number}/comments`, "POST", { text: "  " }))).status).toBe(400);
    as("nurse");
    expect((await POST(jsonReq(`${BASE}/${task.number}/comments`, "POST", { text: "x" }))).status).toBe(403);
  });
});

describe("screenshots", () => {
  it("stores a PNG and its JPEG preview in the task's own folder, typed by bytes", async () => {
    const task = seedTask({ createdById: "u_doc" });
    as("doc");
    const res = await upload(
      String(task.number),
      { bytes: PNG, name: "Снимок экрана.png", type: "application/octet-stream" },
      { bytes: JPEG, type: "image/jpeg" },
    );
    expect(res.status).toBe(201);
    const row = db.attachments[0]!;
    expect(row).toMatchObject({ clinicId: "c1", taskId: task.id, mimeType: "image/png", uploadedById: "u_doc" });
    expect(String(row.objectKey)).toMatch(new RegExp(`^clinics/c1/dev-tasks/${task.id}/[0-9a-f-]+\\.png$`));
    expect(String(row.thumbKey)).toMatch(new RegExp(`^clinics/c1/dev-tasks/${task.id}/[0-9a-f-]+-thumb\\.jpg$`));
    expect(db.objects.get(String(row.objectKey))?.contentType).toBe("image/png");
    expect(db.audits.at(-1)).toMatchObject({ action: AUDIT_ACTION.DEV_TASK_ATTACHMENT_ADDED });
  });

  it("refuses script carriers and non-images whatever the browser claims", async () => {
    const task = seedTask({ createdById: "u_admin" });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = new TextEncoder().encode("<html><script>fetch('/api/crm/patients')</script></html>");
    const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\n");
    for (const file of [
      { bytes: svg, name: "shot.png", type: "image/png" },
      { bytes: svg, name: "shot.svg", type: "image/svg+xml" },
      { bytes: html, name: "shot.jpg", type: "image/jpeg" },
      { bytes: pdf, name: "report.pdf", type: "application/pdf" },
    ]) {
      const res = await upload(String(task.number), file);
      expect(res.status, file.name).toBe(415);
    }
    expect(db.attachments).toHaveLength(0);
    expect(db.objects.size).toBe(0);
  });

  it("caps a screenshot at 10 MB and a task at 20 screenshots", async () => {
    const task = seedTask({ createdById: "u_admin" });
    const big = new Uint8Array(DEV_TASK_MAX_BYTES + 1);
    big.set(PNG);
    expect((await upload(String(task.number), { bytes: big, name: "big.png", type: "image/png" })).status).toBe(413);

    for (let i = 0; i < DEV_TASK_MAX_ATTACHMENTS; i += 1) {
      db.attachments.push({
        id: `att_fill_${i}`,
        clinicId: "c1",
        taskId: task.id,
        objectKey: `clinics/c1/dev-tasks/${task.id}/${i}.png`,
        thumbKey: null,
        mimeType: "image/png",
        sizeBytes: 10,
        uploadedById: "u_admin",
        createdAt: new Date(),
      });
    }
    const res = await upload(String(task.number), { bytes: PNG, name: "s.png", type: "image/png" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("dev_task_attachment_limit");
  });

  it("only the author and managers add screenshots; an odd preview is dropped, not fatal", async () => {
    const task = seedTask({ createdById: "u_doc" });
    as("doc2");
    expect((await upload(String(task.number), { bytes: PNG, name: "s.png", type: "image/png" })).status).toBe(403);
    as("admin");
    // A PNG where a JPEG preview belongs: the screenshot is kept, the preview is not.
    const res = await upload(String(task.number), { bytes: PNG, name: "s.png", type: "image/png" }, { bytes: PNG, type: "image/png" });
    expect(res.status).toBe(201);
    expect(db.attachments[0]!.thumbKey).toBeNull();
  });

  it("streams the stored type with nosniff and the sandbox CSP; the preview when there is one", async () => {
    const task = seedTask({ createdById: "u_admin" });
    await upload(String(task.number), { bytes: PNG, name: "s.png", type: "image/png" }, { bytes: JPEG, type: "image/jpeg" });
    const att = db.attachments[0]!;
    const { GET } = await import("@/app/api/crm/dev-tasks/[id]/attachments/[attachmentId]/route");

    as("desk");
    const full = await GET(new Request(`${BASE}/${task.number}/attachments/${att.id}`));
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("image/png");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    expect(full.headers.get("content-security-policy")).toContain("sandbox");
    expect(full.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(PNG);

    const thumb = await GET(new Request(`${BASE}/${task.id}/attachments/${att.id}?thumb=1`));
    expect(thumb.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await thumb.arrayBuffer())).toEqual(JPEG);

    as("nurse");
    expect((await GET(new Request(`${BASE}/${task.number}/attachments/${att.id}`))).status).toBe(403);
  });

  it("a screenshot is reached only through its own task, and only from its own folder", async () => {
    const a = seedTask({ createdById: "u_admin" });
    const b = seedTask({ createdById: "u_admin" });
    await upload(String(a.number), { bytes: PNG, name: "s.png", type: "image/png" });
    const att = db.attachments[0]!;
    const { GET } = await import("@/app/api/crm/dev-tasks/[id]/attachments/[attachmentId]/route");
    expect((await GET(new Request(`${BASE}/${b.number}/attachments/${att.id}`))).status).toBe(404);

    // A row pointing outside the task folder (a patient document) is refused.
    att.objectKey = "clinics/c1/documents/scan.pdf";
    db.objects.set("clinics/c1/documents/scan.pdf", { bytes: PNG, contentType: "application/pdf" });
    expect((await GET(new Request(`${BASE}/${a.number}/attachments/${att.id}`))).status).toBe(403);
  });

  it("removes a screenshot for the author or a manager, bytes and row", async () => {
    const task = seedTask({ createdById: "u_doc" });
    as("doc");
    await upload(String(task.number), { bytes: PNG, name: "s.png", type: "image/png" }, { bytes: JPEG, type: "image/jpeg" });
    const att = db.attachments[0]!;
    const { DELETE } = await import("@/app/api/crm/dev-tasks/[id]/attachments/[attachmentId]/route");
    const url = `${BASE}/${task.number}/attachments/${att.id}`;

    as("desk");
    expect((await DELETE(new Request(url, { method: "DELETE" }))).status).toBe(403);
    expect(db.attachments).toHaveLength(1);

    as("doc");
    expect((await DELETE(new Request(url, { method: "DELETE" }))).status).toBe(200);
    expect(db.attachments).toHaveLength(0);
    expect(db.objects.size).toBe(0);
    expect(db.audits.at(-1)).toMatchObject({
      action: AUDIT_ACTION.DEV_TASK_ATTACHMENT_REMOVED,
      meta: { number: task.number, attachmentId: att.id },
    });
  });
});
