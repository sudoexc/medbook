/**
 * Audit PH-01 / MA-04 — a contact shared into the bot chat (the Mini App's
 * «Подтвердить номер через Telegram») reaches `applyVerifiedContact`
 * whatever the bot's auto-reply mode, never reaches the FSM (which would
 * answer it with the welcome), and the patient is told the outcome.
 *
 * Audit PT-04 — `/start <invite>` links nothing: the bot asks for the
 * account's own number, and the contact that follows goes to the pending
 * invite instead of the generic contact flow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  clinic: {
    id: "clinic_A",
    slug: "alpha",
    tgBotToken: "TOKEN_A",
    tgBotUsername: "alpha_bot",
    tgWebhookSecret: "SECRET_A",
  },
  applied: [] as unknown[],
  result: { kind: "linked", patientId: "p_clinic", retiredPatientId: "p_auto" } as unknown,
  sent: [] as Array<{ chatId: string; text: string; opts?: unknown }>,
  fsmSteps: 0,
  cardLang: "RU" as "RU" | "UZ",
  pending: null as { token: string; lang: "ru" | "uz" } | null,
  consumed: [] as unknown[],
  consumeResult: { kind: "linked", patientId: "p1", tokenId: "t1" } as {
    kind: string;
    [k: string]: unknown;
  },
  claims: [] as unknown[],
  claimResult: { kind: "claimed", tokenId: "t1", patientId: "p1", lang: "ru" } as {
    kind: string;
    lang?: "ru" | "uz";
    [k: string]: unknown;
  },
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
      findFirst: vi.fn(async () => ({ preferredLang: state.cardLang })),
    },
    conversation: {
      upsert: vi.fn(async () => ({ id: "conv_1", mode: "bot", patientId: null })),
      update: vi.fn(async () => ({})),
    },
    message: { create: vi.fn(async () => ({})) },
  },
}));

vi.mock("@/server/telegram/contact-verify", () => ({
  applyVerifiedContact: vi.fn(async (input: unknown) => {
    state.applied.push(input);
    return state.result;
  }),
  contactReplyKey: (r: { kind: string }) =>
    r.kind === "linked" ? "contact.linked" : "contact.notOwn",
}));

vi.mock("@/server/telegram/send", () => ({
  answerCallbackQuery: vi.fn(async () => undefined),
  editMessageText: vi.fn(async () => ({})),
  sendMessage: vi.fn(async (_c: unknown, chatId: string, text: string, opts?: unknown) => {
    state.sent.push({ chatId: String(chatId), text, ...(opts ? { opts } : {}) });
    return { message_id: 900, chat: { id: chatId } };
  }),
}));
vi.mock("@/server/telegram/state", () => ({
  loadSnapshot: vi.fn(async () => null),
  saveSnapshot: vi.fn(async () => undefined),
  step: vi.fn(() => {
    state.fsmSteps += 1;
    return { next: {}, outgoing: null };
  }),
}));
vi.mock("@/server/telegram/voice-handler", () => ({
  handleDoctorVoice: vi.fn(async () => ({ kind: "not-doctor" as const })),
  resolveDictatingDoctor: vi.fn(async () => null),
}));
vi.mock("@/server/telegram/invite-token", async (orig) => {
  const real = await orig<typeof import("@/server/telegram/invite-token")>();
  return {
    inviteReplyKey: real.inviteReplyKey,
    inviteClaimReplyKey: real.inviteClaimReplyKey,
    consumeInviteToken: vi.fn(async (input: unknown) => {
      state.consumed.push(input);
      return state.consumeResult;
    }),
    claimInviteToken: vi.fn(async (input: unknown) => {
      state.claims.push(input);
      return state.claimResult;
    }),
    findPendingInviteClaim: vi.fn(async () => state.pending),
  };
});
vi.mock("@/server/telegram/inbound-media", () => ({
  ingestTelegramMedia: vi.fn(async () => []),
  mediaPreviewLabel: vi.fn(() => ""),
  inboundLocationText: vi.fn(() => null),
}));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: vi.fn(async () => undefined),
}));
vi.mock("@/server/notifications/auto-messages", () => ({
  readWelcomeConfig: vi.fn(async () => null),
}));

import { POST } from "@/app/api/telegram/webhook/[clinicSlug]/route";
import { t as botT } from "@/server/telegram/messages";

function contactUpdate(fromId: number, userId: number) {
  return {
    update_id: 7,
    message: {
      message_id: 55,
      chat: { id: fromId, type: "private" },
      from: { id: fromId, first_name: "Dilnoza", username: "dilnoza" },
      contact: { phone_number: "998901234567", first_name: "Dilnoza", user_id: userId },
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
  return (POST as unknown as (
    r: Request,
    c: { params: Promise<{ clinicSlug: string }> },
  ) => Promise<Response>)(req, { params: Promise.resolve({ clinicSlug: state.clinic.slug }) });
}

beforeEach(() => {
  state.applied = [];
  state.sent = [];
  state.fsmSteps = 0;
  state.cardLang = "RU";
  state.pending = null;
  state.consumed = [];
  state.consumeResult = { kind: "linked", patientId: "p1", tokenId: "t1" };
  state.claims = [];
  state.claimResult = { kind: "claimed", tokenId: "t1", patientId: "p1", lang: "ru" };
  state.result = { kind: "linked", patientId: "p_clinic", retiredPatientId: "p_auto" };
  delete process.env.TG_BOT_AUTOREPLY;
});

describe("TG webhook — shared contact", () => {
  it("is applied even with the bot's auto-reply OFF (prod default), and answered in the card's language", async () => {
    state.cardLang = "UZ";
    const res = await send(contactUpdate(111, 111));
    expect(res.status).toBe(200);
    expect(state.applied).toEqual([
      {
        clinicId: "clinic_A",
        fromId: 111,
        fromUsername: "dilnoza",
        contact: { phone_number: "998901234567", first_name: "Dilnoza", user_id: 111 },
      },
    ]);
    expect(state.sent).toMatchObject([{ chatId: "111", text: botT("uz", "contact.linked") }]);
  });

  it("never reaches the FSM, even with auto-reply ON", async () => {
    process.env.TG_BOT_AUTOREPLY = "1";
    await send(contactUpdate(111, 111));
    expect(state.fsmSteps).toBe(0);
    expect(state.applied).toHaveLength(1);
  });

  it("hands the raw contact over, so a forwarded one (user_id ≠ sender) is judged by applyVerifiedContact", async () => {
    state.result = { kind: "not-own-contact" };
    await send(contactUpdate(111, 222));
    expect(state.applied[0]).toMatchObject({
      fromId: 111,
      contact: { user_id: 222 },
    });
    expect(state.sent[0]!.text).toBe(botT("ru", "contact.notOwn"));
  });
});

describe("TG webhook — invite link needs the patient's own number (PT-04)", () => {
  function startUpdate(fromId: number, payload: string) {
    return {
      update_id: 8,
      message: {
        message_id: 56,
        chat: { id: fromId, type: "private" },
        from: { id: fromId, first_name: "Stranger" },
        text: `/start ${payload}`,
        date: 1_700_000_000,
      },
    };
  }

  it("/start <token> only asks for the number, with one share-contact button", async () => {
    process.env.TG_BOT_AUTOREPLY = "1";
    await send(startUpdate(999, "tok"));
    expect(state.claims).toEqual([
      { clinicId: "clinic_A", token: "tok", telegramId: "999" },
    ]);
    expect(state.consumed).toHaveLength(0);
    expect(state.fsmSteps).toBe(0);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({
      text: botT("ru", "invite.confirmPhone"),
      opts: {
        reply_markup: {
          keyboard: [[{ text: botT("ru", "invite.shareButton"), request_contact: true }]],
        },
      },
    });
  });

  it("an old or foreign token falls through to the usual welcome", async () => {
    process.env.TG_BOT_AUTOREPLY = "1";
    state.claimResult = { kind: "expired" };
    await send(startUpdate(999, "tok"));
    expect(state.fsmSteps).toBe(1);
  });

  it("the contact after an opened invite goes to the invite, with the contact, not to the generic flow", async () => {
    state.pending = { token: "tok", lang: "uz" };
    await send(contactUpdate(111, 111));
    expect(state.applied).toHaveLength(0);
    expect(state.consumed).toEqual([
      expect.objectContaining({
        clinicId: "clinic_A",
        token: "tok",
        telegramId: "111",
        contact: { phone_number: "998901234567", first_name: "Dilnoza", user_id: 111 },
      }),
    ]);
    expect(state.sent[0]).toMatchObject({
      text: botT("uz", "invite.linked"),
      opts: { reply_markup: { remove_keyboard: true } },
    });
  });

  it("a number that is not the card's is told so, and the button stays for a retry", async () => {
    state.pending = { token: "tok", lang: "ru" };
    state.consumeResult = { kind: "phone-mismatch" };
    await send(contactUpdate(111, 111));
    expect(state.sent[0]).toMatchObject({
      text: botT("ru", "invite.phoneMismatch"),
      opts: { reply_markup: { keyboard: [[{ request_contact: true }]] } },
    });
  });
});
