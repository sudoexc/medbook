/**
 * Audit TG-07 — the invite deep link (the QR in the doctor's «Привязать
 * Telegram» dialog and the one printed on every conclusion) was handled
 * only after the webhook's early exit for `TG_BOT_AUTOREPLY` unset (the
 * production default) and for takeover threads. No QR ever linked anyone.
 * It is identity, not chat: handled in every mode and the patient is told.
 *
 * Audit PT-04 — opening the link binds nothing by itself: the bot asks the
 * account for its own number, and the contact that follows completes the
 * link (checked against the card by consumeInviteToken). That contact is
 * handled in every mode too, and the chat is then tied to the card.
 *
 * Audit TG-11 — a thread from an account that already has a card is that
 * card's thread from the first message; the realtime event carries the
 * patient so the Mini App and the right rail see him.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Conv = { id: string; mode: "bot" | "takeover"; patientId: string | null };

const state = vi.hoisted(() => ({
  clinic: {
    id: "clinic_A",
    slug: "alpha",
    tgBotToken: "TOKEN_A",
    tgBotUsername: "alpha_bot",
    tgWebhookSecret: "SECRET_A",
  },
  conv: { id: "conv_1", mode: "bot", patientId: null } as Conv,
  /** Card holding each Telegram account, as the webhook would read it. */
  cards: {} as Record<string, { id: string; preferredLang: "RU" | "UZ" }>,
  claim: { kind: "not-found" } as Record<string, unknown>,
  claims: [] as unknown[],
  pending: null as { token: string; lang: "ru" | "uz" } | null,
  invite: { kind: "not-found" } as Record<string, unknown>,
  inviteThrows: false,
  consumed: [] as unknown[],
  patientLookups: [] as unknown[],
  sent: [] as Array<{ chatId: string; text: string; opts?: unknown }>,
  outRows: [] as Array<Record<string, unknown>>,
  fsm: [] as unknown[],
  events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  bumped: [] as string[],
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (_ctx: unknown, fn: () => unknown) => fn(),
  getTenant: () => null,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
        where.slug === state.clinic.slug ? { ...state.clinic } : null,
      ),
    },
    patient: {
      findFirst: vi.fn(async ({ where }: { where: { telegramId?: string } }) => {
        state.patientLookups.push(where);
        return where.telegramId ? (state.cards[where.telegramId] ?? null) : null;
      }),
    },
    conversation: {
      upsert: vi.fn(async () => ({ ...state.conv })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: { patientId?: string } }) => {
          // Only the thread↔card link moves `patientId`; the «awaiting reply»
          // stamp (audit G6-03) writes another column.
          if (!("patientId" in data)) return { count: 1 };
          const hit =
            (!("id" in where) || where.id === state.conv.id) &&
            (!("patientId" in where) || where.patientId === state.conv.patientId);
          if (hit) state.conv.patientId = data.patientId!;
          return { count: hit ? 1 : 0 };
        },
      ),
      findFirst: vi.fn(async () => ({ patientId: state.conv.patientId })),
    },
    message: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.direction === "OUT") state.outRows.push(data);
        return {};
      }),
    },
  },
}));

vi.mock("@/server/telegram/invite-token", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/telegram/invite-token")>();
  return {
    ...real,
    claimInviteToken: vi.fn(async (input: unknown) => {
      state.claims.push(input);
      if (state.inviteThrows) throw new Error("db down");
      return state.claim;
    }),
    findPendingInviteClaim: vi.fn(async () => state.pending),
    consumeInviteToken: vi.fn(async (input: { telegramId: string }) => {
      state.consumed.push(input);
      if (state.inviteThrows) throw new Error("db down");
      if (state.invite.kind === "linked") {
        // The invited card now holds the account; the auto card (if any) is retired.
        state.cards[input.telegramId] = {
          id: state.invite.patientId as string,
          preferredLang: "UZ",
        };
      }
      return state.invite;
    }),
  };
});
vi.mock("@/server/telegram/contact-verify", () => ({
  applyVerifiedContact: vi.fn(async () => ({ kind: "not-own-contact" })),
  contactReplyKey: () => "contact.notOwn",
}));
vi.mock("@/server/telegram/send", () => ({
  answerCallbackQuery: vi.fn(async () => undefined),
  editMessageText: vi.fn(async () => ({})),
  sendMessage: vi.fn(async (_c: unknown, chatId: string, text: string, opts?: unknown) => {
    state.sent.push({ chatId: String(chatId), text, ...(opts ? { opts } : {}) });
    return { message_id: 900 + state.sent.length, chat: { id: chatId } };
  }),
}));
vi.mock("@/server/telegram/state", () => ({
  loadSnapshot: vi.fn(async () => null),
  saveSnapshot: vi.fn(async () => undefined),
  step: vi.fn((_prev: unknown, event: unknown) => {
    state.fsm.push(event);
    return { next: {}, outgoing: null };
  }),
}));
vi.mock("@/server/telegram/voice-handler", () => ({
  handleDoctorVoice: vi.fn(async () => ({ kind: "not-doctor" as const })),
  resolveDictatingDoctor: vi.fn(async () => null),
}));
vi.mock("@/server/telegram/inbound-media", () => ({
  DOCTOR_DICTATION_LABEL: "dictation",
  ingestTelegramMedia: vi.fn(async () => []),
  mediaPreviewLabel: vi.fn(() => ""),
  inboundLocationText: vi.fn(() => null),
}));
vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn(
    (_clinicId: string, ev: { type: string; payload: Record<string, unknown> }) => {
      state.events.push(ev);
    },
  ),
}));
vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: vi.fn(async (id: string) => {
    state.bumped.push(id);
  }),
}));
vi.mock("@/server/notifications/auto-messages", () => ({
  readWelcomeConfig: vi.fn(async () => null),
}));

import { POST } from "@/app/api/telegram/webhook/[clinicSlug]/route";
import { t as botT } from "@/server/telegram/messages";

function textUpdate(text: string, opts: { chatId?: number; lang?: string } = {}) {
  return {
    update_id: 7,
    message: {
      message_id: 55,
      chat: { id: opts.chatId ?? 111, type: opts.chatId && opts.chatId < 0 ? "group" : "private" },
      from: { id: 111, first_name: "Dilnoza", username: "dilnoza", language_code: opts.lang },
      text,
      date: 1_700_000_000,
    },
  };
}

async function send(body: unknown) {
  const req = new Request(`https://x/api/telegram/webhook/${state.clinic.slug}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": state.clinic.tgWebhookSecret,
    },
    body: JSON.stringify(body),
  });
  const res = await (POST as unknown as (
    r: Request,
    c: { params: Promise<{ clinicSlug: string }> },
  ) => Promise<Response>)(req, { params: Promise.resolve({ clinicSlug: state.clinic.slug }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function contactUpdate() {
  return {
    update_id: 8,
    message: {
      message_id: 56,
      chat: { id: 111, type: "private" },
      from: { id: 111, first_name: "Dilnoza", username: "dilnoza" },
      contact: { phone_number: "998901234567", first_name: "Dilnoza", user_id: 111 },
      date: 1_700_000_000,
    },
  };
}

const inboundEvent = () => state.events.find((e) => e.type === "tg.message.new");
const claimed = { kind: "claimed", tokenId: "tok_row", patientId: "p1", lang: "uz" };

beforeEach(() => {
  state.conv = { id: "conv_1", mode: "bot", patientId: null };
  state.cards = {};
  state.claim = { kind: "not-found" };
  state.claims = [];
  state.pending = null;
  state.invite = { kind: "not-found" };
  state.inviteThrows = false;
  state.consumed = [];
  state.patientLookups = [];
  state.sent = [];
  state.outRows = [];
  state.fsm = [];
  state.events = [];
  state.bumped = [];
  delete process.env.TG_BOT_AUTOREPLY;
});

describe("invite deep link (audit TG-07, PT-04)", () => {
  it("auto-reply unset (the production default): the patient is asked for his own number, nothing is linked yet", async () => {
    state.claim = claimed;
    const res = await send(textUpdate("/start abc123"));
    expect(res).toEqual({ status: 200, json: { ok: true } });
    expect(state.claims).toEqual([
      { clinicId: "clinic_A", token: "abc123", telegramId: "111" },
    ]);
    expect(state.consumed).toEqual([]);
    expect(state.conv.patientId).toBeNull();
    expect(state.sent).toEqual([
      {
        chatId: "111",
        text: botT("uz", "invite.confirmPhone"),
        opts: {
          reply_markup: expect.objectContaining({
            keyboard: [[{ text: botT("uz", "invite.shareButton"), request_contact: true }]],
          }),
        },
      },
    ]);
    expect(state.outRows).toEqual([
      expect.objectContaining({ conversationId: "conv_1", body: botT("uz", "invite.confirmPhone") }),
    ]);
    // No FSM chatter with auto-reply off.
    expect(state.fsm).toEqual([]);
  });

  it("a thread in operator takeover still gets the question (auto-reply on)", async () => {
    process.env.TG_BOT_AUTOREPLY = "1";
    state.conv.mode = "takeover";
    state.claim = claimed;
    await send(textUpdate("/start abc123"));
    expect(state.claims).toHaveLength(1);
    expect(state.sent[0]?.text).toBe(botT("uz", "invite.confirmPhone"));
    expect(state.fsm).toEqual([]);
  });

  it("with the bot answering, no welcome buries the share button", async () => {
    process.env.TG_BOT_AUTOREPLY = "1";
    state.claim = claimed;
    await send(textUpdate("/start abc123"));
    expect(state.sent).toHaveLength(1);
    expect(state.fsm).toEqual([]);
  });

  it("an account already on the card is told so, and the bot greets as usual", async () => {
    process.env.TG_BOT_AUTOREPLY = "1";
    state.claim = { kind: "already-yours", tokenId: "tok_row", patientId: "p1", lang: "ru" };
    await send(textUpdate("/start abc123"));
    expect(state.sent[0]?.text).toBe(botT("ru", "invite.alreadyYours"));
    expect(state.fsm).toEqual([{ kind: "start", payload: "abc123" }]);
  });

  it("an expired link is answered (in the Telegram app's language) and links nothing", async () => {
    state.claim = { kind: "expired", tokenId: "tok_row" };
    await send(textUpdate("/start old", { lang: "uz" }));
    expect(state.sent).toEqual([{ chatId: "111", text: botT("uz", "invite.expired") }]);
    expect(state.conv.patientId).toBeNull();
  });

  it("a payload that is not ours stays silent", async () => {
    await send(textUpdate("/start utm_instagram"));
    expect(state.claims).toHaveLength(1);
    expect(state.sent).toEqual([]);
  });

  it("a claim failure never costs the patient his message", async () => {
    state.inviteThrows = true;
    const res = await send(textUpdate("/start abc123"));
    expect(res.json).toEqual({ ok: true });
    expect(inboundEvent()).toBeDefined();
  });

  it("a bare /start or plain text never touches invites", async () => {
    await send(textUpdate("/start"));
    await send(textUpdate("Здравствуйте"));
    expect(state.claims).toEqual([]);
    expect(state.consumed).toEqual([]);
  });

  it("the matching contact after the question links the card with auto-reply unset, and the chat follows", async () => {
    state.pending = { token: "abc123", lang: "uz" };
    state.invite = { kind: "linked", patientId: "p1", tokenId: "tok_row", retiredPatientId: null };
    await send(contactUpdate());
    expect(state.consumed).toEqual([
      expect.objectContaining({
        clinicId: "clinic_A",
        token: "abc123",
        telegramId: "111",
        contact: { phone_number: "998901234567", first_name: "Dilnoza", user_id: 111 },
      }),
    ]);
    expect(state.conv.patientId).toBe("p1");
    expect(state.bumped).toContain("p1");
    expect(state.sent[0]?.text).toBe(botT("uz", "invite.linked"));
    expect(state.fsm).toEqual([]);
  });

  it("in operator takeover the contact still completes the link", async () => {
    process.env.TG_BOT_AUTOREPLY = "1";
    state.conv.mode = "takeover";
    state.pending = { token: "abc123", lang: "ru" };
    state.invite = { kind: "linked", patientId: "p1", tokenId: "tok_row", retiredPatientId: null };
    await send(contactUpdate());
    expect(state.consumed).toHaveLength(1);
    expect(state.conv.patientId).toBe("p1");
  });

  it("the thread the webhook tied to the retired auto card moves to the invited card", async () => {
    state.cards["111"] = { id: "p_auto", preferredLang: "RU" };
    state.pending = { token: "abc123", lang: "ru" };
    state.invite = { kind: "linked", patientId: "p1", tokenId: "tok_row", retiredPatientId: "p_auto" };
    await send(contactUpdate());
    expect(state.conv.patientId).toBe("p1");
  });

  it("a number that is not the card's links nothing", async () => {
    state.pending = { token: "abc123", lang: "ru" };
    state.invite = { kind: "phone-mismatch", tokenId: "tok_row", patientId: "p1" };
    await send(contactUpdate());
    expect(state.conv.patientId).toBeNull();
    expect(state.sent[0]?.text).toBe(botT("ru", "invite.phoneMismatch"));
  });
});

describe("thread ↔ card on arrival (audit TG-11)", () => {
  it("a sender whose account has a card: the thread is that card's from the first message", async () => {
    state.cards["111"] = { id: "p1", preferredLang: "RU" };
    await send(textUpdate("болит голова после препарата"));
    expect(state.conv.patientId).toBe("p1");
    expect(inboundEvent()?.payload.patientId).toBe("p1");
    expect(state.bumped).toEqual(["p1"]);
  });

  it("a thread reception already linked keeps its card", async () => {
    state.conv.patientId = "p_mother";
    state.cards["111"] = { id: "p_son", preferredLang: "RU" };
    await send(textUpdate("Это сын, по маме вопрос"));
    expect(state.conv.patientId).toBe("p_mother");
    expect(inboundEvent()?.payload.patientId).toBe("p_mother");
  });

  it("a group chat is not one person: no card is looked up", async () => {
    state.cards["111"] = { id: "p1", preferredLang: "RU" };
    await send(textUpdate("всем привет", { chatId: -100123 }));
    expect(state.patientLookups).toEqual([]);
    expect(state.conv.patientId).toBeNull();
  });
});
