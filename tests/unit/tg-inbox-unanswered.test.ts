import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit G6-03: «Неотвеченные» filtered on `unreadCount > 0`. Opening a chat
 * marks it read, so the thread vanished from the tab and from the chat pane a
 * second after the click, before anyone answered; entering the section
 * auto-opened the freshest thread and «read» it for everyone.
 *
 * Now a thread carries `awaitingReplySince`: set by a patient message that
 * needs a person, cleared by a staff reply that reached the patient or by
 * «Ответ не нужен». The tab filters on it, reading leaves it alone, and the
 * inbox opens nothing by itself.
 */

const state = vi.hoisted(() => ({
  role: "RECEPTIONIST" as string,
  findManyWhere: null as null | Record<string, unknown>,
  findFirstWhere: null as null | Record<string, unknown>,
  findFirstArgs: null as null | Record<string, unknown>,
  updateManyData: [] as Array<Record<string, unknown>>,
  events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  conv: {
    id: "conv_1",
    clinicId: "clinic_A",
    patientId: null as string | null,
    unreadCount: 2,
    awaitingReplySince: new Date("2026-09-30T05:00:00Z") as Date | null,
    mode: "bot",
    status: "OPEN",
    assignedToId: null,
    externalId: "555",
    contactUsername: null,
  },
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
        ctx: { kind: "TENANT", clinicId: "clinic_A", userId: "u1", role: state.role },
      });
    };
  return { createApiHandler: handler, createApiListHandler: handler };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn((_c: string, e: { type: string; payload: Record<string, unknown> }) => {
    state.events.push(e);
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        state.findManyWhere = where;
        return [];
      }),
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        state.findFirstWhere = args.where;
        state.findFirstArgs = args;
        return { ...state.conv };
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.updateManyData.push(data);
        Object.assign(state.conv, data);
        return { count: 1 };
      }),
    },
    doctor: {
      findFirst: vi.fn(async () => ({ id: "doc_1", userId: "u1" })),
    },
  },
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GET as LIST } from "@/app/api/crm/conversations/route";
import { GET as GET_ONE, PATCH } from "@/app/api/crm/conversations/[id]/route";
import {
  CONTACT_ORIGIN,
  clearAwaitingReply,
  inboundNeedsReply,
  markAwaitingReply,
  storedInboundNeedsReply,
} from "@/server/conversations/reply-state";
import { pickSelectedConversation } from "@/app/[locale]/crm/telegram/_hooks/use-conversations";
import type { InboxConversation } from "@/app/[locale]/crm/telegram/_hooks/types";

const call = (h: unknown, url: string, init?: RequestInit) =>
  (h as (r: Request) => Promise<Response>)(new Request(url, init));

beforeEach(() => {
  state.role = "RECEPTIONIST";
  state.findManyWhere = null;
  state.findFirstWhere = null;
  state.findFirstArgs = null;
  state.updateManyData = [];
  state.events = [];
  state.conv.unreadCount = 2;
  state.conv.awaitingReplySince = new Date("2026-09-30T05:00:00Z");
});

describe("«Неотвеченные» is «no staff reply yet», not «unread» (audit G6-03)", () => {
  it("the tab filters on awaitingReplySince, whatever was read", async () => {
    await call(LIST, "https://crm.test/api/crm/conversations?channel=TG&unanswered=1");
    expect(state.findManyWhere).toMatchObject({
      channel: "TG",
      awaitingReplySince: { not: null },
    });
    expect(state.findManyWhere).not.toHaveProperty("unreadCount");
  });

  it("marking a chat read leaves it waiting for a reply", async () => {
    await call(PATCH, "https://crm.test/api/crm/conversations/conv_1", {
      method: "PATCH",
      body: JSON.stringify({ markRead: true }),
    });
    expect(state.updateManyData).toEqual([{ unreadCount: 0 }]);
    expect(state.conv.awaitingReplySince).not.toBeNull();
  });

  it("«Ответ не нужен» takes it out of the tab without a reply", async () => {
    await call(PATCH, "https://crm.test/api/crm/conversations/conv_1", {
      method: "PATCH",
      body: JSON.stringify({ markAnswered: true }),
    });
    expect(state.updateManyData).toEqual([{ awaitingReplySince: null }]);
    expect(state.events.at(-1)).toMatchObject({
      type: "tg.conversation.updated",
      payload: { conversationId: "conv_1", awaitingReplySince: null },
    });
  });

  it("the inbox opens nothing by itself, and keeps the chosen thread after it leaves the tab", () => {
    const row = { id: "conv_1", unreadCount: 0 } as InboxConversation;
    // Entering the section: no selection, no thread, nothing marked read.
    expect(
      pickSelectedConversation({ selectedId: null, rows: [row], fetched: undefined, previous: null }),
    ).toBeNull();
    // The operator answered: the row left «Неотвеченные», the chat stays,
    // first from what was on screen, then from the thread fetched by id.
    expect(
      pickSelectedConversation({ selectedId: "conv_1", rows: [], fetched: undefined, previous: row }),
    ).toBe(row);
    const fetched = { ...row, awaitingReplySince: null };
    expect(
      pickSelectedConversation({ selectedId: "conv_1", rows: [], fetched, previous: row }),
    ).toBe(fetched);
    // Never another thread than the one selected.
    expect(
      pickSelectedConversation({
        selectedId: "conv_2",
        rows: [row],
        fetched: undefined,
        previous: row,
      }),
    ).toBeNull();
  });
});

describe("what makes a thread wait (audit G6-03)", () => {
  it("a question waits; bot commands, a shared contact and a dictation do not", () => {
    expect(inboundNeedsReply({ text: "Можно перенести на завтра?" })).toBe(true);
    expect(inboundNeedsReply({ text: null })).toBe(true); // a photo, a voice note
    expect(inboundNeedsReply({ text: "/start" })).toBe(false);
    expect(inboundNeedsReply({ text: "/start inv_abc" })).toBe(false);
    expect(inboundNeedsReply({ text: "+998901112233", hasContact: true })).toBe(false);
    expect(inboundNeedsReply({ text: null, doctorDictation: true })).toBe(false);
  });

  it("keeps the oldest waiting message: three in a row wait since the first", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const at = new Date("2026-09-30T06:00:00Z");
    await markAwaitingReply({ conversation: { updateMany } } as never, "conv_1", at);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "conv_1", awaitingReplySince: null },
      data: { awaitingReplySince: at },
    });
  });

  it("a reply answers what was asked before it, not what came in after", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repliedAt = new Date("2026-09-30T06:00:00Z");
    const later = new Date("2026-09-30T06:00:05Z");
    const findMany = vi.fn(async () => [
      { createdAt: new Date("2026-09-30T06:00:01Z"), body: "/start" },
      { createdAt: later, body: "А на завтра?" },
    ]);
    await clearAwaitingReply(
      { conversation: { updateMany }, message: { findMany } } as never,
      "conv_1",
      repliedAt,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "conv_1", awaitingReplySince: { lte: repliedAt } },
      data: { awaitingReplySince: later },
    });

    findMany.mockResolvedValueOnce([]);
    await clearAwaitingReply(
      { conversation: { updateMany }, message: { findMany } } as never,
      "conv_1",
      repliedAt,
    );
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: "conv_1", awaitingReplySince: { lte: repliedAt } },
      data: { awaitingReplySince: null },
    });
  });
});

describe("a shared contact never waits, stored or live (pre-deploy review)", () => {
  it("a stored contact row is its bare number: the marker keeps it out", () => {
    expect(storedInboundNeedsReply({ body: "998901234567", origin: CONTACT_ORIGIN })).toBe(false);
    // The same digits typed by the patient are a message like any other.
    expect(storedInboundNeedsReply({ body: "998901234567", origin: null })).toBe(true);
    expect(storedInboundNeedsReply({ body: "🎤 Диктовка врача" })).toBe(false);
    expect(storedInboundNeedsReply({ body: "/start" })).toBe(false);
  });

  it("a reply followed only by a contact share leaves nothing waiting", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repliedAt = new Date("2026-09-30T06:00:00Z");
    const findMany = vi.fn(async () => [
      { createdAt: new Date("2026-09-30T06:00:01Z"), body: "+998901234567", origin: CONTACT_ORIGIN },
    ]);
    await clearAwaitingReply(
      { conversation: { updateMany }, message: { findMany } } as never,
      "conv_1",
      repliedAt,
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ origin: true }) }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "conv_1", awaitingReplySince: { lte: repliedAt } },
      data: { awaitingReplySince: null },
    });
  });
});

describe("the «Неотвеченные» backfill (pre-deploy review)", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260930210000_tg_inbox_reply_send_state/migration.sql",
    ),
    "utf8",
  );
  const backfill = sql.slice(sql.indexOf("UPDATE \"Conversation\""));

  it("skips the contacts stored before the marker: a bare number with nothing attached", () => {
    const shape = /COALESCE\(m\."body", ''\) ~ '(.+?)'/.exec(backfill);
    expect(shape, "phone-shape filter").not.toBeNull();
    expect(backfill).toMatch(/AND NOT \(\s*COALESCE\(m\."body"/);
    expect(backfill).toMatch(/COALESCE\(m\."attachments", 'null'::jsonb\) = 'null'::jsonb/);
    // The same pattern, read as the database reads it.
    const phone = new RegExp(shape![1]!);
    expect(phone.test("998901234567")).toBe(true);
    expect(phone.test("+998901234567")).toBe(true);
    expect(phone.test("Можно на 15:00?")).toBe(false);
    expect(phone.test("12")).toBe(false);
  });

  it("only fills the tab with what is still current: unread, or written to in the last 14 days", () => {
    expect(backfill).toMatch(/MAX\(m\."createdAt"\) AS "lastIn"/);
    expect(backfill).toMatch(
      /c\."unreadCount" > 0\s+OR w\."lastIn" > CURRENT_TIMESTAMP - INTERVAL '14 days'/,
    );
  });
});

describe("a thread opened by id (audit G6-07)", () => {
  it("returns the list row's shape, the blocked flag included", async () => {
    const res = await call(GET_ONE, "https://crm.test/api/crm/conversations/conv_1");
    expect(res.status).toBe(200);
    expect(state.findFirstArgs).toMatchObject({
      include: { patient: { select: { tgBlockedAt: true } } },
    });
    expect(state.findFirstWhere).toEqual({ id: "conv_1", clinicId: "clinic_A" });
  });

  it("a doctor reads by id only what his list would show", async () => {
    state.role = "DOCTOR";
    await call(GET_ONE, "https://crm.test/api/crm/conversations/conv_1");
    expect(state.findFirstWhere).toMatchObject({
      id: "conv_1",
      clinicId: "clinic_A",
      // DC-10: a stranger's unlinked thread is the desk's, not his.
      AND: [{ OR: expect.arrayContaining([{ assignedToId: "u1" }]) }],
    });
    const or = (state.findFirstWhere as { AND: { OR: unknown[] }[] }).AND[0]!.OR;
    expect(or).not.toContainEqual({ patientId: null });
  });
});
