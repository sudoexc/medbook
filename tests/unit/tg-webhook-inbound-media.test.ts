import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit TG-01 through the webhook: a patient's voice note becomes a Message
 * with a playable attachment and a non-empty inbox preview, and a shared
 * location becomes readable text. Before, both were stored with no body and
 * no attachment, shown as «Без текста».
 *
 * A doctor's voice note is a SOAP dictation, not chat: it goes to his draft
 * only and never becomes a playable attachment in the shared inbox.
 */

const state = vi.hoisted(() => ({
  clinic: {
    id: "clinic_A",
    slug: "alpha",
    tgBotToken: "TOKEN_A",
    tgBotUsername: "alpha_bot",
    tgWebhookSecret: "SECRET_A",
  },
  messages: [] as Array<Record<string, unknown>>,
  convUpdates: [] as Array<Record<string, unknown>>,
  events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  doctor: null as null | { userId: string; doctorId: string; lang: "ru" },
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (_ctx: unknown, fn: () => unknown) => fn(),
  getTenant: () => null,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async () => ({ ...state.clinic })),
    },
    conversation: {
      upsert: vi.fn(async () => ({ id: "conv_1", mode: "takeover", patientId: "p1" })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.convUpdates.push(args.data);
        return {};
      }),
    },
    message: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.messages.push(args.data);
        return {};
      }),
    },
  },
}));

vi.mock("@/server/telegram/bot-api", () => ({
  getFile: vi.fn(async (_t: string, fileId: string) => ({
    ok: true,
    result: { file_id: fileId, file_path: `voice/${fileId}.oga` },
  })),
  buildFileDownloadUrl: (_t: string, p: string) => `https://tg.test/${p}`,
}));
vi.mock("@/server/storage/minio", () => ({
  isStubMode: () => false,
  uploadObject: vi.fn(async () => undefined),
}));

vi.mock("@/server/telegram/send", () => ({
  answerCallbackQuery: vi.fn(async () => undefined),
  editMessageText: vi.fn(async () => ({})),
  sendMessage: vi.fn(async () => ({ message_id: 900, chat: { id: 1 } })),
}));
vi.mock("@/server/telegram/state", () => ({
  loadSnapshot: vi.fn(async () => null),
  saveSnapshot: vi.fn(async () => undefined),
  step: vi.fn(() => ({ next: {}, outgoing: null })),
}));
vi.mock("@/server/telegram/voice-handler", () => ({
  // By default the sender is a patient, not a doctor dictating a SOAP note.
  resolveDictatingDoctor: vi.fn(async () => state.doctor),
  handleDoctorVoice: vi.fn(async () =>
    state.doctor
      ? { kind: "queued" as const, replyText: "ok", caseId: "case_1" }
      : { kind: "not-doctor" as const },
  ),
}));
vi.mock("@/server/telegram/invite-token", () => ({
  consumeInviteToken: vi.fn(async () => ({ kind: "not-found" as const })),
}));
vi.mock("@/server/telegram/contact-verify", () => ({
  applyVerifiedContact: vi.fn(async () => ({ kind: "linked" })),
  contactReplyKey: () => "contact.linked",
}));
vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn(
    (_c: string, e: { type: string; payload: Record<string, unknown> }) => {
      state.events.push(e);
    },
  ),
}));
vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: vi.fn(async () => undefined),
}));
vi.mock("@/server/notifications/auto-messages", () => ({
  readWelcomeConfig: vi.fn(async () => null),
}));

import { POST } from "@/app/api/telegram/webhook/[clinicSlug]/route";
import { handleDoctorVoice } from "@/server/telegram/voice-handler";
import { getFile } from "@/server/telegram/bot-api";

const OGG = new Uint8Array([
  ..."OggS".split("").map((c) => c.charCodeAt(0)),
  0, 2, 0, 0, 0, 0, 0, 0, 0, 0,
]);

async function send(message: Record<string, unknown>) {
  const req = new Request(`https://x/api/telegram/webhook/${state.clinic.slug}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": state.clinic.tgWebhookSecret,
    },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 77,
        chat: { id: 555, type: "private" },
        from: { id: 555, first_name: "Мухаммад" },
        date: 1_700_000_000,
        ...message,
      },
    }),
  });
  return (POST as unknown as (
    r: Request,
    c: { params: Promise<{ clinicSlug: string }> },
  ) => Promise<Response>)(req, { params: Promise.resolve({ clinicSlug: state.clinic.slug }) });
}

beforeEach(() => {
  state.messages = [];
  state.convUpdates = [];
  state.events = [];
  state.doctor = null;
  vi.mocked(handleDoctorVoice).mockClear();
  vi.mocked(getFile).mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(OGG, { status: 200 })));
});

describe("TG webhook — patient media (audit TG-01)", () => {
  it("records a patient's voice note with a playable attachment and a preview", async () => {
    const res = await send({
      voice: { file_id: "v1", file_unique_id: "u1", duration: 9, mime_type: "audio/ogg" },
    });
    expect(res.status).toBe(200);
    expect(state.messages).toHaveLength(1);
    const m = state.messages[0]!;
    expect(m.body).toBeNull();
    expect(m.attachments).toEqual([
      expect.objectContaining({
        kind: "file",
        mimeType: "audio/ogg",
        tgType: "voice",
        durationSec: 9,
      }),
    ]);
    expect(state.convUpdates).toContainEqual({ lastMessageText: "🎤 Голосовое" });
    const newMsg = state.events.find((e) => e.type === "tg.message.new");
    expect(newMsg?.payload.preview).toBe("🎤 Голосовое");
  });

  it("records a shared location as text with coordinates", async () => {
    await send({ location: { latitude: 41.311081, longitude: 69.240562 } });
    expect(state.messages[0]!.body).toBe(
      "📍 41.311081, 69.240562\nhttps://maps.google.com/?q=41.311081,69.240562",
    );
    expect(state.messages[0]!.attachments).toBeNull();
  });
});

describe("TG webhook — a doctor's voice dictation", () => {
  const doctor = { userId: "u_doc", doctorId: "d_doc", lang: "ru" as const };

  it("leaves no attachment on the Message and goes to the SOAP pipeline only", async () => {
    state.doctor = doctor;
    const res = await send({
      voice: { file_id: "v9", file_unique_id: "u9", duration: 41, mime_type: "audio/ogg" },
    });
    expect(res.status).toBe(200);
    expect(state.messages).toHaveLength(1);
    const m = state.messages[0]!;
    expect(m.attachments).toBeNull();
    expect(m.body).toBe("🎤 Диктовка врача");
    // Nothing was fetched or re-hosted for the inbox: the voice handler is
    // the only reader of the file.
    expect(getFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(handleDoctorVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        tgUserId: "555",
        voice: { duration: 41, file_id: "v9" },
        doctor,
      }),
    );
    const newMsg = state.events.find((e) => e.type === "tg.message.new");
    expect(newMsg?.payload.preview).toBe("🎤 Диктовка врача");
  });

  it("drops the caption of a dictated audio file too", async () => {
    state.doctor = doctor;
    await send({
      audio: { file_id: "a1", file_unique_id: "ua1", duration: 60, mime_type: "audio/mpeg" },
      caption: "Каримова, 54 года, после карбамазепина атаксия",
    });
    expect(state.messages[0]!.body).toBe("🎤 Диктовка врача");
    expect(state.messages[0]!.attachments).toBeNull();
  });
});
