/**
 * Audit TG-11 — Telegram threads and patient cards.
 *
 * Reception links a thread to a card from the inbox's right rail. The PATCH
 * used to write only `Conversation.patientId`: the card never learned its
 * Telegram account, reminders went to «нет канала», and the next message
 * arrived in an unlinked thread again. The link now writes the account onto
 * the card, under the P1 identity rules: one card per account, never taken
 * from a card with history (a TELEGRAM_LINK_CONFLICT task instead), never
 * overwriting the card's own account.
 *
 * Review of that fix: the name and number reception links by are typed
 * from the chat, and whoever holds the card's Telegram opens it in the Mini
 * App. So the account lands on its own only on a card with no history the
 * profile goes by; anything else waits for staff to confirm, and a chat the
 * bot tied to the Mini App's stub can still move to the clinic card.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => {
  const matches = (row: Record<string, unknown>, where?: Record<string, unknown>): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => matches(row, w));
      if (v && typeof v === "object" && !(v instanceof Date) && "not" in v) {
        return row[k] !== (v as { not: unknown }).not;
      }
      return (row[k] ?? null) === v;
    });
  };
  return {
    matches,
    patients: [] as Array<Record<string, unknown>>,
    conversations: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
    conflicts: [] as unknown[],
    retirable: new Set<string>(),
    raceOnLink: false,
    role: "RECEPTIONIST",
  };
});

vi.mock("@/lib/prisma", () => {
  const patient = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const row = db.patients.find((p) => db.matches(p, where));
      return row ? { ...row } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      if (db.raceOnLink && typeof data.telegramId === "string") {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row = db.patients.find((p) => p.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const rows = db.patients.filter((p) => db.matches(p, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    }),
  };
  const conversation = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const row = db.conversations.find((c) => db.matches(c, where));
      return row ? { ...row } : null;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const rows = db.conversations.filter((c) => db.matches(c, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    }),
  };
  return {
    prisma: {
      patient,
      conversation,
      auditLog: {
        create: vi.fn(async ({ data }: { data: Row }) => {
          db.audits.push(data);
          return data;
        }),
        // Newest first: rows are kept in the order they were written.
        findFirst: vi.fn(async ({ where }: { where: Row & { action?: { in: string[] } } }) => {
          const { action, ...rest } = where;
          const rows = db.audits.filter(
            (a) => db.matches(a, rest) && (!action || action.in.includes(a.action as string)),
          );
          return rows.length > 0 ? { ...rows[rows.length - 1] } : null;
        }),
      },
      $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
    },
  };
});

vi.mock("@/server/patient/phone-identity", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/patient/phone-identity")>();
  return {
    ...real,
    isRetirableAutoCard: vi.fn(async (_db: unknown, id: string) => db.retirable.has(id)),
  };
});
vi.mock("@/server/patient/telegram-link-conflict", () => ({
  raiseTelegramLinkConflict: vi.fn(async (params: unknown) => {
    db.conflicts.push(params);
  }),
}));
vi.mock("@/lib/api-handler", () => {
  const handler =
    (
      opts: { bodySchema?: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } },
      fn: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const parsed = opts.bodySchema?.safeParse(await request.json());
      if (parsed && !parsed.success) return Response.json({ error: "Validation" }, { status: 400 });
      return fn({
        request,
        body: parsed?.data,
        ctx: { kind: "TENANT", clinicId: "clinic_A", userId: "u_reception", role: db.role },
      });
    };
  return { createApiHandler: handler, createApiListHandler: handler };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));

import { PATCH } from "@/app/api/crm/conversations/[id]/route";
import { audit } from "@/lib/audit";
import { unlinkErrorKey } from "@/app/[locale]/crm/telegram/_lib/unlink-error";
import { threadTelegramId } from "@/server/conversations/link-patient";
import {
  goesByCardName,
  isUnconfirmedMiniAppCard,
} from "@/lib/patients/telegram-card";
import {
  attachThreadToLinkedCard,
  linkThreadToSenderCard,
  privateChatSenderId,
} from "@/server/telegram/thread-patient";
import { prisma } from "@/lib/prisma";

function card(id: string, extra: Row = {}): Row {
  return {
    id,
    clinicId: "clinic_A",
    fullName: `Card ${id}`,
    telegramId: null,
    telegramUsername: null,
    telegramLinkedAt: null,
    deletedAt: null,
    ...extra,
  };
}

function thread(id: string, extra: Row = {}): Row {
  return {
    id,
    clinicId: "clinic_A",
    channel: "TG",
    externalId: "555",
    patientId: null,
    contactUsername: "dilnoza",
    mode: "bot",
    status: "OPEN",
    assignedToId: null,
    unreadCount: 0,
    ...extra,
  };
}

async function patch(conversationId: string, body: Row) {
  const res = await (PATCH as unknown as (r: Request) => Promise<Response>)(
    new Request(`https://crm.test/api/crm/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Row };
}

const p = (id: string) => db.patients.find((r) => r.id === id)!;
const c = (id: string) => db.conversations.find((r) => r.id === id)!;

beforeEach(() => {
  vi.clearAllMocks();
  db.patients = [];
  db.conversations = [];
  db.audits = [];
  db.conflicts = [];
  db.retirable = new Set();
  db.raceOnLink = false;
  db.role = "RECEPTIONIST";
});

/** Dilnoza writes from her own account; her profile says so. */
const DILNOZA = { contactFirstName: "Dilnoza", contactLastName: "Karimova" };
/** Card history as the `_count` of `cardHoldsHistory` sees it. */
const HISTORY = { _count: { appointments: 4, visitNotes: 3, documents: 1 } };

describe("linking a thread from the right rail writes the card's Telegram", () => {
  it("an empty card the profile goes by learns the account (id, username, first-link time) and an audit row is written", async () => {
    db.patients.push(card("p1", { fullName: "Каримова Дилноза" }));
    db.conversations.push(thread("conv_1", DILNOZA));
    const res = await patch("conv_1", { patientId: "p1" });
    expect(res.status).toBe(200);
    expect(res.json.telegramLink).toEqual({ kind: "linked", retiredPatientId: null });
    expect(c("conv_1").patientId).toBe("p1");
    expect(p("p1")).toMatchObject({ telegramId: "555", telegramUsername: "dilnoza" });
    expect(p("p1").telegramLinkedAt).toBeInstanceOf(Date);
    expect(db.audits).toEqual([
      expect.objectContaining({
        action: "patient.telegram.inbox_linked",
        entityId: "p1",
        actorId: "u_reception",
        meta: expect.objectContaining({ telegramId: "555", confirmed: false }),
      }),
    ]);
  });

  it("a card bound to another account keeps it; the thread is still linked and the rail is told", async () => {
    db.patients.push(card("p1", { telegramId: "999" }));
    db.conversations.push(thread("conv_1"));
    const res = await patch("conv_1", { patientId: "p1" });
    expect(res.json.telegramLink).toEqual({ kind: "card-has-other-telegram" });
    expect(c("conv_1").patientId).toBe("p1");
    expect(p("p1").telegramId).toBe("999");
    expect(db.audits).toEqual([]);
  });

  it("the account's empty Mini App card is retired and its threads follow", async () => {
    // The profile says only «Dilnoza»; the patient corrected her name in the
    // Mini App, and that card's name counts like in the P1 contact check.
    db.patients.push(
      card("p1", { fullName: "Каримова Дилноза" }),
      card("p_auto", { telegramId: "555", fullName: "Karimova Dilnoza" }),
    );
    db.conversations.push(
      thread("conv_1", { contactFirstName: "Dilnoza" }),
      thread("conv_inapp", { externalId: null, patientId: "p_auto" }),
    );
    db.retirable.add("p_auto");
    const res = await patch("conv_1", { patientId: "p1" });
    expect(res.json.telegramLink).toEqual({ kind: "linked", retiredPatientId: "p_auto" });
    expect(p("p1").telegramId).toBe("555");
    expect(p("p_auto")).toMatchObject({ telegramId: null, deletionReason: "duplicate_of:p1" });
    expect(p("p_auto").deletedAt).toBeInstanceOf(Date);
    expect(c("conv_inapp").patientId).toBe("p1");
  });

  it("never takes the account from a card with history: nothing written, reception gets a task", async () => {
    db.patients.push(card("p1"), card("p_mother", { telegramId: "555", fullName: "Каримова Мунира" }));
    db.conversations.push(thread("conv_1"));
    const res = await patch("conv_1", { patientId: "p1" });
    expect(res.json.telegramLink).toEqual({
      kind: "telegram-on-other-card",
      otherPatientId: "p_mother",
      otherPatientName: "Каримова Мунира",
    });
    expect(p("p1").telegramId).toBeNull();
    expect(p("p_mother").telegramId).toBe("555");
    expect(db.conflicts).toEqual([
      expect.objectContaining({
        clinicId: "clinic_A",
        telegramId: "555",
        telegramCard: expect.objectContaining({ id: "p_mother", fullName: "Каримова Мунира" }),
        clinicCard: { id: "p1", fullName: "Card p1" },
        via: "inbox",
      }),
    ]);
    // The thread link itself is reception's call and stays.
    expect(c("conv_1").patientId).toBe("p1");
  });

  it("a concurrent Mini App first open that wins the unique index changes nothing", async () => {
    db.patients.push(card("p1", { fullName: "Каримова Дилноза" }));
    db.conversations.push(thread("conv_1", DILNOZA));
    db.raceOnLink = true;
    const res = await patch("conv_1", { patientId: "p1" });
    expect(res.status).toBe(200);
    expect(res.json.telegramLink).toMatchObject({ kind: "telegram-on-other-card" });
    expect(p("p1").telegramId).toBeNull();
  });

  it("a card of another clinic, or a deleted one, cannot be linked", async () => {
    db.patients.push(card("p_B", { clinicId: "clinic_B" }), card("p_gone", { deletedAt: new Date() }));
    db.conversations.push(thread("conv_1"));
    expect((await patch("conv_1", { patientId: "p_B" })).status).toBe(404);
    expect((await patch("conv_1", { patientId: "p_gone" })).status).toBe(404);
    expect(c("conv_1").patientId).toBeNull();
  });

  it("a group thread carries no one's account: only the thread is linked", async () => {
    db.patients.push(card("p1"));
    db.conversations.push(thread("conv_g", { externalId: "-1001234" }));
    const res = await patch("conv_g", { patientId: "p1" });
    expect(res.json.telegramLink).toBeNull();
    expect(c("conv_g").patientId).toBe("p1");
    expect(p("p1").telegramId).toBeNull();
  });

  it("other edits (status, tags) never touch a card", async () => {
    db.patients.push(card("p1"));
    db.conversations.push(thread("conv_1", { patientId: "p1" }));
    const res = await patch("conv_1", { status: "CLOSED" });
    expect(res.json.telegramLink).toBeNull();
    expect(prisma.patient.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ telegramId: "555" }) }),
    );
    expect(p("p1").telegramId).toBeNull();
  });
});

describe("a card with history or another name is bound only on staff confirmation", () => {
  it("Мария's card with history is not handed to whoever typed her name and number: thread linked, Telegram untouched", async () => {
    // The chat's profile even goes by her name: a name and a number are
    // exactly what a stranger or a relative can type.
    db.patients.push(card("p_maria", { fullName: "Иванова Мария", ...HISTORY }));
    db.conversations.push(thread("conv_1", { contactFirstName: "Mariya", contactLastName: "Ivanova" }));
    const res = await patch("conv_1", { patientId: "p_maria" });
    expect(res.status).toBe(200);
    expect(res.json.telegramLink).toEqual({ kind: "needs-confirm", reason: "history" });
    expect(c("conv_1").patientId).toBe("p_maria");
    expect(p("p_maria").telegramId).toBeNull();
    expect(p("p_maria").telegramLinkedAt).toBeNull();
    expect(db.audits).toEqual([]);
    expect(db.conflicts).toEqual([]);
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });

  it("a son writing about his mother: her new card is not bound to his account without confirmation", async () => {
    db.patients.push(card("p_mother", { fullName: "Каримова Мунира" }));
    db.conversations.push(thread("conv_1", { contactFirstName: "Aziz", contactLastName: "Karimov" }));
    const res = await patch("conv_1", { patientId: "p_mother" });
    expect(res.json.telegramLink).toEqual({ kind: "needs-confirm", reason: "name" });
    expect(c("conv_1").patientId).toBe("p_mother");
    expect(p("p_mother").telegramId).toBeNull();
  });

  it("a profile with a first name only is not proof either", async () => {
    db.patients.push(card("p1", { fullName: "Каримова Дилноза" }));
    db.conversations.push(thread("conv_1", { contactFirstName: "Dilnoza" }));
    const res = await patch("conv_1", { patientId: "p1" });
    expect(res.json.telegramLink).toEqual({ kind: "needs-confirm", reason: "name" });
    expect(p("p1").telegramId).toBeNull();
  });

  it("the rail's confirmation binds the linked card with history, audited as confirmed", async () => {
    db.patients.push(card("p_maria", { fullName: "Иванова Мария", ...HISTORY }));
    db.conversations.push(thread("conv_1", { patientId: "p_maria" }));
    const res = await patch("conv_1", { linkTelegram: true });
    expect(res.status).toBe(200);
    expect(res.json.telegramLink).toEqual({ kind: "linked", retiredPatientId: null });
    expect(p("p_maria")).toMatchObject({ telegramId: "555", telegramUsername: "dilnoza" });
    expect(db.audits).toEqual([
      expect.objectContaining({
        action: "patient.telegram.inbox_linked",
        entityId: "p_maria",
        actorId: "u_reception",
        meta: expect.objectContaining({ confirmed: true }),
      }),
    ]);
    // A bare confirmation leaves the thread row alone.
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("confirmation still never takes the account from another card with history", async () => {
    db.patients.push(
      card("p_maria", { fullName: "Иванова Мария", ...HISTORY }),
      card("p_son", { telegramId: "555", fullName: "Иванов Азиз" }),
    );
    db.conversations.push(thread("conv_1", { patientId: "p_maria" }));
    const res = await patch("conv_1", { linkTelegram: true });
    expect(res.json.telegramLink).toMatchObject({
      kind: "telegram-on-other-card",
      otherPatientId: "p_son",
    });
    expect(p("p_maria").telegramId).toBeNull();
    expect(p("p_son").telegramId).toBe("555");
  });

  it("only the roles that can hand out the card's invite may confirm", async () => {
    db.patients.push(card("p_maria", { fullName: "Иванова Мария", ...HISTORY }));
    db.conversations.push(thread("conv_1", { patientId: "p_maria" }));
    for (const role of ["NURSE", "CALL_OPERATOR"]) {
      db.role = role;
      const res = await patch("conv_1", { linkTelegram: true });
      expect(res.status).toBe(403);
      expect(res.json.reason).toBe("telegram_link_role");
    }
    expect(p("p_maria").telegramId).toBeNull();
  });

  it("nothing to confirm on a group chat or an unlinked thread", async () => {
    db.patients.push(card("p1"));
    db.conversations.push(
      thread("conv_g", { externalId: "-1001234", patientId: "p1" }),
      thread("conv_free"),
    );
    expect((await patch("conv_g", { linkTelegram: true })).status).toBe(400);
    expect((await patch("conv_free", { linkTelegram: true })).status).toBe(400);
    expect(p("p1").telegramId).toBeNull();
  });
});

describe("a chat the bot tied to the Mini App's stub can move to the clinic card", () => {
  it("an unconfirmed Mini App card is told apart from real cards", () => {
    const stub = { source: "TELEGRAM", phoneNormalized: "tg:555", phoneVerifiedAt: null };
    expect(isUnconfirmedMiniAppCard(stub)).toBe(true);
    // A number typed into the Mini App is only a claim.
    expect(isUnconfirmedMiniAppCard({ ...stub, phoneNormalized: "+998901234567" })).toBe(true);
    // A number the account shared as its own contact, or staff typed.
    expect(isUnconfirmedMiniAppCard({ ...stub, phoneVerifiedAt: "2026-09-01T00:00:00Z" })).toBe(false);
    // A relative on the family's number, a child added in the Mini App.
    expect(isUnconfirmedMiniAppCard({ ...stub, phoneNormalized: "contact:abc" })).toBe(false);
    expect(isUnconfirmedMiniAppCard({ ...stub, phoneNormalized: "family:p1:abc" })).toBe(false);
    // Clinic cards.
    expect(isUnconfirmedMiniAppCard({ source: "WALKIN", phoneNormalized: "+998901234567", phoneVerifiedAt: null })).toBe(false);
    expect(isUnconfirmedMiniAppCard({ source: null, phoneNormalized: "+998901234567", phoneVerifiedAt: null })).toBe(false);
  });

  it("the rail shows the relink form on such a card and the Telegram bind asks for confirmation", async () => {
    const { readFileSync } = await import("node:fs");
    const rail = readFileSync(
      "src/app/[locale]/crm/telegram/_components/chat-right-rail.tsx",
      "utf8",
    );
    expect(rail).toMatch(/isUnconfirmedMiniAppCard\(p\)/);
    expect(rail).toMatch(/<CreatePatientForm conversation=\{conversation\} relink \/>/);
    expect(rail).toMatch(/JSON\.stringify\(\{ linkTelegram: true \}\)/);
    expect(rail).toMatch(/kind === "needs-confirm"/);
  });

  it("relinking to Мария's clinic card moves the chat; her account follows once staff confirm, and the stub is retired", async () => {
    db.patients.push(
      card("p_stub", { telegramId: "555", fullName: "Masha" }),
      card("p_maria", { fullName: "Иванова Мария", ...HISTORY }),
    );
    db.conversations.push(
      thread("conv_bot", { patientId: "p_stub", contactFirstName: "Masha" }),
      thread("conv_inapp", { externalId: null, patientId: "p_stub" }),
    );
    db.retirable.add("p_stub");

    const moved = await patch("conv_bot", { patientId: "p_maria" });
    expect(moved.json.telegramLink).toEqual({ kind: "needs-confirm", reason: "history" });
    expect(c("conv_bot").patientId).toBe("p_maria");
    expect(p("p_stub").telegramId).toBe("555");
    expect(p("p_stub").deletedAt).toBeNull();

    const confirmed = await patch("conv_bot", { linkTelegram: true });
    expect(confirmed.json.telegramLink).toEqual({ kind: "linked", retiredPatientId: "p_stub" });
    expect(p("p_maria").telegramId).toBe("555");
    expect(p("p_stub")).toMatchObject({ telegramId: null, deletionReason: "duplicate_of:p_maria" });
    expect(c("conv_inapp").patientId).toBe("p_maria");
  });

  it("a new card for the stub's owner takes the account at once when her profile goes by its name", async () => {
    db.patients.push(
      card("p_stub", { telegramId: "555", fullName: "Dilnoza Karimova" }),
      card("p_new", { fullName: "Каримова Дилноза" }),
    );
    db.conversations.push(thread("conv_bot", { patientId: "p_stub", ...DILNOZA }));
    db.retirable.add("p_stub");
    const res = await patch("conv_bot", { patientId: "p_new" });
    expect(res.json.telegramLink).toEqual({ kind: "linked", retiredPatientId: "p_stub" });
    expect(c("conv_bot").patientId).toBe("p_new");
    expect(p("p_new").telegramId).toBe("555");
  });
});

describe("G6-14 review: an untied chat does not come back with the next message", () => {
  /** The webhook's step for the patient's next message in the chat. */
  const nextMessage = () =>
    linkThreadToSenderCard(prisma, {
      clinicId: "clinic_A",
      conversationId: "conv_1",
      telegramId: "555",
    });

  it("an account the inbox wrote onto the wrong card leaves with the chat, so the webhook finds no card", async () => {
    // The operator created her card from the chat with a mistyped number:
    // a duplicate, empty, the profile goes by its name, so bound on its own.
    db.patients.push(card("p_dup", { fullName: "Каримова Дилноза" }));
    db.conversations.push(thread("conv_1", DILNOZA));
    expect((await patch("conv_1", { patientId: "p_dup" })).json.telegramLink).toEqual({
      kind: "linked",
      retiredPatientId: null,
    });
    expect(p("p_dup").telegramId).toBe("555");

    const res = await patch("conv_1", { patientId: null });
    expect(res.status).toBe(200);
    expect(res.json.telegramUnlinked).toBe(true);
    expect(c("conv_1").patientId).toBeNull();
    // Reminders and conclusions no longer go to this Telegram, and a later
    // link to the right card is not a TELEGRAM_LINK_CONFLICT.
    expect(p("p_dup")).toMatchObject({
      telegramId: null,
      telegramUsername: null,
      telegramLinkedAt: null,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "patient.telegram.inbox_unlinked",
        entityId: "p_dup",
        meta: { telegramId: "555", conversationId: "conv_1" },
      }),
    );

    expect(await nextMessage()).toBeNull();
    expect(c("conv_1").patientId).toBeNull();

    // Linked to the right card, the account follows without a conflict.
    db.patients.push(card("p_right", { fullName: "Каримова Дилноза" }));
    const relinked = await patch("conv_1", { patientId: "p_right" });
    expect(relinked.json.telegramLink).toEqual({ kind: "linked", retiredPatientId: null });
    expect(p("p_right").telegramId).toBe("555");
    expect(db.conflicts).toEqual([]);
  });

  it("an account the card holds by an invite or the Mini App keeps the chat: refused, nothing written", async () => {
    db.patients.push(card("p_own", { telegramId: "555", telegramUsername: "dilnoza" }));
    db.conversations.push(thread("conv_1", { patientId: "p_own" }));
    db.audits.push({
      clinicId: "clinic_A",
      action: "patient.telegram.invite_consumed",
      entityType: "Patient",
      entityId: "p_own",
      meta: { telegramId: "555" },
    });
    const res = await patch("conv_1", { patientId: null });
    expect(res.status).toBe(409);
    expect(res.json.reason).toBe("card_owns_telegram");
    expect(c("conv_1").patientId).toBe("p_own");
    expect(p("p_own").telegramId).toBe("555");
    expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
    expect(unlinkErrorKey(res.status, res.json)).toBe("cardOwnsTelegram");

    // The Mini App's own card: no binding event at all.
    db.audits = [];
    expect((await patch("conv_1", { patientId: null })).status).toBe(409);
    expect(c("conv_1").patientId).toBe("p_own");
  });

  it("the newest binding decides: an invite consumed after the inbox link keeps the chat", async () => {
    db.patients.push(card("p1", { fullName: "Каримова Дилноза" }));
    db.conversations.push(thread("conv_1", DILNOZA));
    await patch("conv_1", { patientId: "p1" });
    db.audits.push({
      clinicId: "clinic_A",
      action: "patient.telegram.invite_consumed",
      entityType: "Patient",
      entityId: "p1",
      meta: { telegramId: "555" },
    });
    expect((await patch("conv_1", { patientId: null })).status).toBe(409);
    expect(p("p1").telegramId).toBe("555");
  });

  it("a card without the chat's account: only the thread is untied, and the webhook leaves it free", async () => {
    db.patients.push(card("p_mother", { telegramId: "999" }));
    db.conversations.push(thread("conv_1", { patientId: "p_mother" }));
    const res = await patch("conv_1", { patientId: null });
    expect(res.status).toBe(200);
    expect(res.json.telegramUnlinked).toBe(false);
    expect(c("conv_1").patientId).toBeNull();
    expect(p("p_mother").telegramId).toBe("999");
    expect(prisma.patient.updateMany).not.toHaveBeenCalled();
    expect(await nextMessage()).toBeNull();
  });

  it("a confirmed binding is undone only by the roles that confirm", async () => {
    db.patients.push(card("p_maria", { fullName: "Иванова Мария", ...HISTORY }));
    db.conversations.push(thread("conv_1", { patientId: "p_maria" }));
    await patch("conv_1", { linkTelegram: true });
    expect(p("p_maria").telegramId).toBe("555");

    db.role = "NURSE";
    const refused = await patch("conv_1", { patientId: null });
    expect(refused.status).toBe(403);
    expect(refused.json.reason).toBe("telegram_link_role");
    expect(unlinkErrorKey(refused.status, refused.json)).toBe("roleRequired");
    expect(c("conv_1").patientId).toBe("p_maria");
    expect(p("p_maria").telegramId).toBe("555");

    db.role = "RECEPTIONIST";
    const res = await patch("conv_1", { patientId: null });
    expect(res.json.telegramUnlinked).toBe(true);
    expect(p("p_maria").telegramId).toBeNull();
    expect(c("conv_1").patientId).toBeNull();
  });

  it("other refusals stay generic", () => {
    expect(unlinkErrorKey(404, { error: "NotFound" })).toBe("failed");
    expect(unlinkErrorKey(500, null)).toBe("failed");
  });

  it("the rail hides «Отвязать» on an unconfirmed Mini App card and says the refusal in words", async () => {
    const { readFileSync } = await import("node:fs");
    const rail = readFileSync(
      "src/app/[locale]/crm/telegram/_components/chat-right-rail.tsx",
      "utf8",
    );
    expect(rail).toMatch(/isPrivateChatId\(conversation\.externalId\) &&\s*!miniAppCard/);
    expect(rail).toMatch(/unlinkErrorKey\(res\.status, j\)/);
    const ru = JSON.parse(readFileSync("src/messages/ru.json", "utf8"));
    const uz = JSON.parse(readFileSync("src/messages/uz.json", "utf8"));
    for (const key of ["warningTelegram", "doneWithTelegram", "cardOwnsTelegram", "roleRequired"]) {
      expect(ru.tgInbox.rail.unlink[key], key).toBeTruthy();
      expect(uz.tgInbox.rail.unlink[key], key).toBeTruthy();
      expect(ru.tgInbox.rail.unlink[key], key).not.toMatch(/[—–]/);
      expect(uz.tgInbox.rail.unlink[key], key).not.toMatch(/[—–]/);
    }
  });
});

describe("goesByCardName", () => {
  it("either writing order and either alphabet; never a surname or a first name alone", () => {
    expect(goesByCardName(["Dilnoza Karimova"], "Каримова Дилноза")).toBe(true);
    expect(goesByCardName([null, "Каримова Дилноза"], "Каримова Дилноза")).toBe(true);
    expect(goesByCardName(["Dilnoza"], "Каримова Дилноза")).toBe(false);
    expect(goesByCardName(["Aziz Karimov"], "Каримова Мунира")).toBe(false);
    expect(goesByCardName([], "Каримова Дилноза")).toBe(false);
  });
});

describe("threadTelegramId", () => {
  it("only a private TG chat carries an account", () => {
    expect(threadTelegramId({ channel: "TG", externalId: "555" })).toBe("555");
    expect(threadTelegramId({ channel: "TG", externalId: "-1001234" })).toBeNull();
    expect(threadTelegramId({ channel: "TG", externalId: null })).toBeNull();
    expect(threadTelegramId({ channel: "CALL", externalId: "555" })).toBeNull();
  });
});

describe("bot thread ↔ the sender's card (webhook helpers)", () => {
  it("privateChatSenderId: the sender only in his own private chat", () => {
    expect(privateChatSenderId("555", 555)).toBe("555");
    expect(privateChatSenderId("-1001234", 555)).toBeNull();
    expect(privateChatSenderId("555", undefined)).toBeNull();
  });

  it("an unlinked thread is tied to the card holding the sender's account", async () => {
    db.patients.push(card("p1", { telegramId: "555" }));
    db.conversations.push(thread("conv_1"));
    const linked = await linkThreadToSenderCard(prisma, {
      clinicId: "clinic_A",
      conversationId: "conv_1",
      telegramId: "555",
    });
    expect(linked).toBe("p1");
    expect(c("conv_1").patientId).toBe("p1");
  });

  it("a thread reception linked by hand keeps its card", async () => {
    db.patients.push(card("p_son", { telegramId: "555" }));
    db.conversations.push(thread("conv_1", { patientId: "p_mother" }));
    const linked = await linkThreadToSenderCard(prisma, {
      clinicId: "clinic_A",
      conversationId: "conv_1",
      telegramId: "555",
    });
    expect(linked).toBeNull();
    expect(c("conv_1").patientId).toBe("p_mother");
  });

  it("no card for the account: the thread stays unlinked", async () => {
    db.conversations.push(thread("conv_1"));
    expect(
      await linkThreadToSenderCard(prisma, {
        clinicId: "clinic_A",
        conversationId: "conv_1",
        telegramId: "555",
      }),
    ).toBeNull();
  });

  it("after a retire, the retired card's threads move with the account", async () => {
    db.conversations.push(
      thread("conv_bot", { patientId: "p_auto" }),
      thread("conv_inapp", { externalId: null, patientId: "p_auto" }),
      thread("conv_other", { externalId: "777", patientId: "p_other" }),
    );
    const attached = await attachThreadToLinkedCard(prisma, {
      clinicId: "clinic_A",
      conversationId: "conv_bot",
      patientId: "p1",
      retiredPatientId: "p_auto",
    });
    expect(attached).toBe(true);
    expect(c("conv_bot").patientId).toBe("p1");
    expect(c("conv_inapp").patientId).toBe("p1");
    expect(c("conv_other").patientId).toBe("p_other");
  });
});
