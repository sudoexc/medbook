/**
 * Audit DC-10 — a doctor opening a Telegram thread zeroed reception's
 * «непрочитано» (one shared counter per thread), and every stranger's
 * unlinked thread put «+1» on every doctor's badge.
 *
 * Pinned:
 *   1. A doctor's markRead writes his own read mark; the shared counter moves
 *      only on a thread assigned to him. Reception's read is unchanged.
 *   2. His unread is his own: the shared counter on a thread he never opened,
 *      the inbound messages after his mark on one he did.
 *   3. His scope no longer holds unlinked threads, unless assigned to him.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { doctorConversationScope } from "@/server/conversations/doctor-scope";
import {
  doctorReadClearsSharedUnread,
  doctorUnreadByConversation,
  splitDoctorUnread,
} from "@/server/conversations/doctor-unread";

type Role = "DOCTOR" | "RECEPTIONIST";

const state = vi.hoisted(() => ({
  role: "DOCTOR" as "DOCTOR" | "RECEPTIONIST",
  conv: {} as Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  const handler =
    (
      opts: { bodySchema?: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } },
      fn: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const parsed =
        request.method === "GET" ? undefined : opts.bodySchema?.safeParse(await request.json());
      if (parsed && !parsed.success) return Response.json({ error: "Validation" }, { status: 400 });
      return fn({
        request,
        body: parsed?.data,
        ctx: { kind: "TENANT", clinicId: "clinic_A", userId: "u_doc", role: state.role },
      });
    };
  return { createApiHandler: handler, createApiListHandler: handler };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
const list = vi.hoisted(() => ({
  findMany: [] as Array<(args: { where: Record<string, unknown> }) => unknown>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: { findFirst: vi.fn(async () => ({ id: "doc_1", userId: "u_doc" })) },
    message: {
      groupBy: vi.fn(async () => [{ conversationId: "t_read", _count: { _all: 1 } }]),
    },
    conversation: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) =>
        (list.findMany.shift() ?? (() => []))(args),
      ),
      // «Все N» of the first page (audit G6-22).
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => ({ ...state.conv })),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        Object.assign(state.conv, data);
        return { count: 1 };
      }),
    },
    conversationRead: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        state.upserts.push(args);
        return {};
      }),
    },
  },
}));

beforeEach(() => {
  state.role = "DOCTOR";
  state.conv = {
    id: "conv_1",
    clinicId: "clinic_A",
    patientId: "p1",
    unreadCount: 3,
    assignedToId: null,
    externalId: null,
    status: "OPEN",
    mode: "bot",
  };
  state.updates = [];
  state.upserts = [];
});

async function markRead(role: Role) {
  state.role = role;
  const { PATCH } = await import("@/app/api/crm/conversations/[id]/route");
  return PATCH(
    new Request("https://crm.test/api/crm/conversations/conv_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markRead: true }),
    }),
  );
}

describe("DC-10: a doctor's read is his own", () => {
  it("opening his patient's thread leaves reception's unread alone", async () => {
    const res = await markRead("DOCTOR");
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([]);
    expect(state.conv.unreadCount).toBe(3);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]).toMatchObject({
      where: { conversationId_userId: { conversationId: "conv_1", userId: "u_doc" } },
      create: { clinicId: "clinic_A", conversationId: "conv_1", userId: "u_doc" },
    });
  });

  it("on a thread assigned to him he is the desk: the shared counter clears too", async () => {
    state.conv.assignedToId = "u_doc";
    await markRead("DOCTOR");
    expect(state.updates).toEqual([{ unreadCount: 0 }]);
    expect(state.upserts).toHaveLength(1);
  });

  it("reception reads the shared counter as before, no personal mark", async () => {
    await markRead("RECEPTIONIST");
    expect(state.updates).toEqual([{ unreadCount: 0 }]);
    expect(state.upserts).toHaveLength(0);
  });

  it("the rule itself", () => {
    expect(doctorReadClearsSharedUnread({ assignedToId: "u_doc" }, "u_doc")).toBe(true);
    expect(doctorReadClearsSharedUnread({ assignedToId: null }, "u_doc")).toBe(false);
    expect(doctorReadClearsSharedUnread({ assignedToId: "u_desk" }, "u_doc")).toBe(false);
  });
});

describe("DC-10: what is unread for him", () => {
  const t0 = new Date("2026-10-01T05:00:00.000Z");
  const later = new Date("2026-10-01T06:00:00.000Z");

  it("never opened: the desk's counter; read since the last message: nothing", () => {
    const { known, needsCount } = splitDoctorUnread([
      { id: "fresh", unreadCount: 2, lastMessageAt: later, readAt: null },
      { id: "quiet", unreadCount: 0, lastMessageAt: later, readAt: null },
      { id: "read", unreadCount: 5, lastMessageAt: t0, readAt: later },
      { id: "newer", unreadCount: 0, lastMessageAt: later, readAt: t0 },
    ]);
    expect([...known.entries()]).toEqual([["fresh", 2]]);
    // Reception already read «newer» (0), yet a message came after HIS mark.
    expect(needsCount).toEqual([{ id: "newer", after: t0 }]);
  });

  it("counts inbound messages after his mark, inside his scope only", async () => {
    let convWhere: Record<string, unknown> | null = null;
    let msgWhere: Record<string, unknown> | null = null;
    const db = {
      conversation: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          convWhere = where;
          return [
            { id: "a", unreadCount: 4, lastMessageAt: later, reads: [] },
            { id: "b", unreadCount: 0, lastMessageAt: later, reads: [{ readAt: t0 }] },
            { id: "c", unreadCount: 7, lastMessageAt: t0, reads: [{ readAt: later }] },
          ];
        }),
      },
      message: {
        groupBy: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          msgWhere = where;
          return [{ conversationId: "b", _count: { _all: 1 } }];
        }),
      },
    };
    const map = await doctorUnreadByConversation(
      { doctorId: "doc_1", userId: "u_doc" },
      db as never,
    );
    expect([...map.entries()].sort()).toEqual([
      ["a", 4],
      ["b", 1],
    ]);
    expect(msgWhere).toEqual({
      direction: "IN",
      OR: [{ conversationId: "b", createdAt: { gt: t0 } }],
    });
    const scope = (convWhere as unknown as { AND: Array<{ OR?: unknown[] }> }).AND[0]!.OR;
    expect(scope).toEqual(doctorConversationScope("doc_1", "u_doc"));
  });

  it("a page with no rows asks nothing", async () => {
    const db = { conversation: { findMany: vi.fn() }, message: { groupBy: vi.fn() } };
    const map = await doctorUnreadByConversation(
      { doctorId: "doc_1", userId: "u_doc", conversationIds: [] },
      db as never,
    );
    expect(map.size).toBe(0);
    expect(db.conversation.findMany).not.toHaveBeenCalled();
  });
});

describe("DC-10: a stranger's unlinked thread is the desk's", () => {
  it("the scope holds his appointments, his patients and threads assigned to him", () => {
    expect(doctorConversationScope("doc_1", "u_doc")).toEqual([
      { appointment: { doctorId: "doc_1" } },
      { patient: { appointments: { some: { doctorId: "doc_1" } } } },
      { assignedToId: "u_doc" },
    ]);
    expect(doctorConversationScope("doc_1", null)).not.toContainEqual({
      patientId: null,
    });
  });
});

describe("DC-10: his inbox shows his own unread", () => {
  it("the list replaces the desk's counter with his", async () => {
    const t0 = new Date("2026-10-01T05:00:00.000Z");
    const later = new Date("2026-10-01T06:00:00.000Z");
    list.findMany = [
      // The page.
      () => [
        { id: "t_new", unreadCount: 2 },
        { id: "t_read", unreadCount: 0 },
        { id: "t_done", unreadCount: 5 },
      ],
      // His candidates for that page.
      () => [
        { id: "t_new", unreadCount: 2, lastMessageAt: later, reads: [] },
        { id: "t_read", unreadCount: 0, lastMessageAt: later, reads: [{ readAt: t0 }] },
        { id: "t_done", unreadCount: 5, lastMessageAt: t0, reads: [{ readAt: later }] },
      ],
    ];
    state.role = "DOCTOR";
    const { GET } = await import("@/app/api/crm/conversations/route");
    const res = await GET(
      new Request("https://crm.test/api/crm/conversations?doctorId=me&limit=50"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ id: string; unreadCount: number }> };
    expect(body.rows.map((r) => [r.id, r.unreadCount])).toEqual([
      ["t_new", 2],
      ["t_read", 1],
      ["t_done", 0],
    ]);
  });
});
