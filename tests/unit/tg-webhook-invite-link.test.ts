/**
 * Audit TG-07 — the invite deep link (the QR in the doctor's «Привязать
 * Telegram» dialog and the one printed on every conclusion) was consumed
 * only after the webhook's early exit for `TG_BOT_AUTOREPLY` unset (the
 * production default) and for takeover threads. No QR ever linked anyone.
 * It is identity, not chat: consumed in every mode, the chat is tied to the
 * card and the patient is told.
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
  invite: { kind: "not-found" } as Record<string, unknown>,
  inviteThrows: false,
  consumed: [] as unknown[],
  patientLookups: [] as unknown[],
  sent: [] as Array<{ chatId: string; text: string }>,
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
        async ({ where, data }: { where: Record<string, unknown>; data: { patientId: string } }) => {
          const hit =
            (!("id" in where) || where.id === state.conv.id) &&
            (!("patientId" in where) || where.patientId === state.conv.patientId);
          if (hit) state.conv.patientId = data.patientId;
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
  sendMessage: vi.fn(async (_c: unknown, chatId: string, text: string) => {
    state.sent.push({ chatId: String(chatId), text });
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

const inboundEvent = () => state.events.find((e) => e.type === "tg.message.new");

beforeEach(() => {
  state.conv = { id: "conv_1", mode: "bot", patientId: null };
  state.cards = {};
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

describe("invite deep link (audit TG-07)", () => {
  it("auto-reply unset (the production default): the token is consumed, the chat tied to the card, the patient told", async () => {
    state.invite = { kind: "linked", patientId: "p1", tokenId: "tok_row", retiredPatientId: null };
    const res = await send(textUpdate("/start abc123"));
    expect(res).toEqual({ status: 200, json: { ok: true } });
    expect(state.consumed).toEqual([
      {
        clinicId: "clinic_A",
        token: "abc123",
        telegramId: "111",
        telegramUsername: "dilnoza",
      },
    ]);
    expect(state.conv.patientId).toBe("p1");
    expect(state.sent).toEqual([{ chatId: "111", text: botT("uz", "invite.linked") }]);
    expect(state.outRows).toEqual([
      expect.objectContaining({ conversationId: "conv_1", body: botT("uz", "invite.linked") }),
    ]);
    // The inbox and the Mini App learn the patient with this very message.
    expect(inboundEvent()?.payload.patientId).toBe("p1");
    expect(state.bumped).toContain("p1");
    // No FSM chatter with auto-reply off.
    expect(state.fsm).toEqual([]);
  });

  it("a thread in operator takeover still consumes the token (auto-reply on)", async () => {
    process.env.TG_BOT_AUTOREPLY = "1";
    state.conv.mode = "takeover";
    state.invite = { kind: "linked", patientId: "p1", tokenId: "tok_row", retiredPatientId: null };
    await send(textUpdate("/start abc123"));
    expect(state.consumed).toHaveLength(1);
    expect(state.conv.patientId).toBe("p1");
    expect(state.fsm).toEqual([]);
  });

  it("with auto-reply on and the bot answering, the FSM still greets after the link", async () => {
    process.env.TG_BOT_AUTOREPLY = "1";
    state.invite = { kind: "linked", patientId: "p1", tokenId: "tok_row", retiredPatientId: null };
    await send(textUpdate("/start abc123"));
    expect(state.consumed).toHaveLength(1);
    expect(state.fsm).toEqual([{ kind: "start", payload: "abc123" }]);
  });

  it("the thread the webhook tied to the retired auto card moves to the invited card", async () => {
    state.cards["111"] = { id: "p_auto", preferredLang: "RU" };
    state.invite = { kind: "linked", patientId: "p1", tokenId: "tok_row", retiredPatientId: "p_auto" };
    await send(textUpdate("/start abc123"));
    expect(state.conv.patientId).toBe("p1");
    expect(inboundEvent()?.payload.patientId).toBe("p1");
  });

  it("an expired link is answered (in the Telegram app's language) and links nothing", async () => {
    state.invite = { kind: "expired", tokenId: "tok_row" };
    await send(textUpdate("/start old", { lang: "uz" }));
    expect(state.sent).toEqual([{ chatId: "111", text: botT("uz", "invite.expired") }]);
    expect(state.conv.patientId).toBeNull();
  });

  it("a payload that is not ours stays silent", async () => {
    await send(textUpdate("/start utm_instagram"));
    expect(state.consumed).toHaveLength(1);
    expect(state.sent).toEqual([]);
  });

  it("a consume failure never costs the patient his message", async () => {
    state.inviteThrows = true;
    const res = await send(textUpdate("/start abc123"));
    expect(res.json).toEqual({ ok: true });
    expect(inboundEvent()).toBeDefined();
  });

  it("a bare /start or plain text never touches invites", async () => {
    await send(textUpdate("/start"));
    await send(textUpdate("Здравствуйте"));
    expect(state.consumed).toEqual([]);
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
