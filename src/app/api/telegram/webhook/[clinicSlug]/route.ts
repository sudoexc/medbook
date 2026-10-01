/**
 * Multi-tenant Telegram webhook.
 *
 * POST /api/telegram/webhook/[clinicSlug]
 *
 * Responsibilities:
 *   1. Look up the clinic by slug (no session — auth is the header secret).
 *   2. Verify `X-Telegram-Bot-Api-Secret-Token` against `Clinic.tgWebhookSecret`.
 *   3. Upsert a Conversation for the chat, append an incoming Message, update
 *      unread counters and preview text.
 *   4. Dispatch the update to the FSM when `mode = BOT`; in `TAKEOVER` mode
 *      only persist and notify operator — the FSM stays silent. Identity
 *      updates (an invite `/start <token>`, a shared contact) are handled
 *      in every mode: they are not chat (audit TG-07, PH-01).
 *   5. Always answer callback_query so Telegram stops spinning.
 *   6. Publish an `tg.message.new` event for the realtime bus.
 *
 * Why no NextAuth: Telegram cannot sign requests with a user session. The
 * clinic-scoped webhook secret is the authenticator. Everything runs under
 * `runWithTenant({kind: "SYSTEM"})`, which disables auto-scoping — we must
 * pass `clinicId` explicitly in every Prisma call.
 */

import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { readTgBotToken } from "@/server/crypto/secret-fields";

import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  type TgClinicMinimal,
} from "@/server/telegram/send";
import { confirmAppointment } from "@/server/appointments/confirm";
import { telegramUserMayConfirm } from "@/server/notifications/family-relay";
import {
  type Catalog,
  type FsmEvent,
  loadSnapshot,
  saveSnapshot,
  step,
} from "@/server/telegram/state";
import {
  handleDoctorVoice,
  resolveDictatingDoctor,
} from "@/server/telegram/voice-handler";
import {
  claimInviteToken,
  consumeInviteToken,
  findPendingInviteClaim,
  inviteClaimReplyKey,
  inviteReplyKey,
  type InviteClaimResult,
} from "@/server/telegram/invite-token";
import {
  applyVerifiedContact,
  contactReplyKey,
  type SharedContact,
} from "@/server/telegram/contact-verify";
import { t as botT, type BotLang } from "@/server/telegram/messages";
import {
  attachThreadToLinkedCard,
  linkThreadToSenderCard,
  privateChatSenderId,
} from "@/server/telegram/thread-patient";
import {
  DOCTOR_DICTATION_LABEL,
  inboundLocationText,
  ingestTelegramMedia,
  mediaPreviewLabel,
} from "@/server/telegram/inbound-media";
import { publishEventSafe } from "@/server/realtime/publish";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";
import {
  CONTACT_ORIGIN,
  inboundNeedsReply,
  markAwaitingReply,
} from "@/server/conversations/reply-state";
import {
  readWelcomeConfig,
  type WelcomeConfig,
} from "@/server/notifications/auto-messages";

// Telegram may burst updates; the runtime must be Node (crypto + fetch).
export const runtime = "nodejs";
// The webhook must not be statically cached.
export const dynamic = "force-dynamic";

type TgChat = { id: number; type?: string; username?: string };
type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};
type TgVoice = {
  duration: number;
  mime_type?: string;
  file_id: string;
  file_unique_id: string;
  file_size?: number;
};
type TgAudio = {
  duration: number;
  mime_type?: string;
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  performer?: string;
  title?: string;
};
type TgIncomingMessage = {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: unknown;
  document?: unknown;
  video?: unknown;
  animation?: unknown;
  voice?: TgVoice;
  audio?: TgAudio;
  video_note?: unknown;
  sticker?: unknown;
  location?: unknown;
  venue?: unknown;
  contact?: SharedContact;
  date: number;
};
type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgIncomingMessage;
  data?: string;
};
type TgChatMember = { status: string; user?: TgUser };
type TgChatMemberUpdated = {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: TgChatMember;
  new_chat_member: TgChatMember;
};
type TgUpdate = {
  update_id: number;
  message?: TgIncomingMessage;
  edited_message?: TgIncomingMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: TgChatMemberUpdated;
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function previewOf(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function loadClinicBySlug(slug: string): Promise<{
  id: string;
  slug: string;
  tgBotToken: string | null;
  tgBotUsername: string | null;
  tgWebhookSecret: string | null;
} | null> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const row = await prisma.clinic.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        tgBotToken: true,
        tgBotUsername: true,
        tgWebhookSecret: true,
      },
    });
    if (!row) return null;
    // Decrypt the at-rest token once at load: everything downstream
    // (voice-handler / inbound-media getFile calls, send.ts replies) then
    // works with a usable value. send.ts re-checks the envelope, so passing
    // plaintext through it is fine.
    return { ...row, tgBotToken: readTgBotToken(row.tgBotToken) };
  });
}

function loadBotCatalog(
  miniAppUrl: string | null,
  welcome: WelcomeConfig | null,
): Catalog {
  // Simplified FSM needs the Mini App URL to decide whether to attach a
  // `web_app` button to the welcome message, plus the clinic's configurable
  // welcome (CRM «Авто-сообщения» widget). No services / doctors / slots are
  // walked in chat anymore — booking happens inside the Mini App.
  return { miniAppUrl, welcome };
}

/**
 * Upsert Conversation + append incoming Message.
 *
 * `doctorDictation`: the sender is an active DOCTOR and the voice/audio goes
 * to his SOAP draft. The row then carries only a neutral line, no media and
 * no caption: the doctor's bot thread is unlinked, so everyone working the
 * inbox (and other doctors, through the unlinked «front door» scope) could
 * otherwise play a dictation about a named patient.
 */
async function recordIncoming(
  clinic: TgClinicMinimal & { tgWebhookSecret: string | null },
  chatId: string,
  message: TgIncomingMessage,
  opts: { doctorDictation?: boolean } = {},
): Promise<{
  conversationId: string;
  mode: "bot" | "takeover";
  patientId: string | null;
  preview: string;
}> {
  const textBody = opts.doctorDictation
    ? DOCTOR_DICTATION_LABEL
    : (message.text ??
      message.caption ??
      (message.contact ? message.contact.phone_number : null) ??
      inboundLocationText(message) ??
      "");
  const now = new Date();
  const contact = {
    contactFirstName: message.from?.first_name ?? null,
    contactLastName: message.from?.last_name ?? null,
    contactUsername: message.from?.username ?? null,
  };

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    // Upsert first so we have the conversation id for the media storage key.
    const conv = await prisma.conversation.upsert({
      where: {
        clinicId_externalId: { clinicId: clinic.id, externalId: chatId },
      },
      create: {
        clinicId: clinic.id,
        channel: "TG",
        mode: "bot",
        status: "OPEN",
        externalId: chatId,
        lastMessageAt: now,
        lastMessageText: previewOf(textBody),
        unreadCount: 1,
        ...contact,
      },
      update: {
        lastMessageAt: now,
        lastMessageText: previewOf(textBody),
        unreadCount: { increment: 1 },
        status: "OPEN",
        ...contact,
      },
      select: { id: true, mode: true, patientId: true },
    });

    // The sender already has a card here (Mini App sign-in, an invite, a
    // shared contact): this is that card's thread (audit TG-11). Resolved
    // before the realtime event so the Mini App's patient-scoped chat and
    // the inbox's right rail both get the patient with the first message.
    // Best-effort: a lookup hiccup must never cost the patient his message.
    let patientId = conv.patientId;
    const senderTgId = privateChatSenderId(chatId, message.from?.id);
    if (!patientId && senderTgId) {
      patientId = await linkThreadToSenderCard(prisma, {
        clinicId: clinic.id,
        conversationId: conv.id,
        telegramId: senderTgId,
      }).catch((linkErr: unknown) => {
        console.warn(`[tg:webhook] thread card lookup failed`, linkErr);
        return null;
      });
    }

    // Download any inbound photo/document/video/voice/sticker and re-host it
    // as an attachment (audit TG-01: voice notes used to be dropped). Never a
    // doctor's dictation: its audio is fetched by the SOAP pipeline alone.
    const attachments = opts.doctorDictation
      ? []
      : await ingestTelegramMedia(clinic, conv.id, message);
    const preview =
      previewOf(textBody) || mediaPreviewLabel(attachments, message);

    // Media with no caption left the upsert preview empty — refine it so the
    // inbox row doesn't show a blank last message.
    if (!previewOf(textBody) && preview) {
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { lastMessageText: preview },
      });
    }

    // Dedupe on (clinicId, externalId) — Telegram may retry a webhook.
    const externalId = String(message.message_id);
    let stored = false;
    try {
      await prisma.message.create({
        data: {
          clinicId: clinic.id,
          conversationId: conv.id,
          direction: "IN",
          body: textBody || null,
          attachments: attachments.length > 0 ? attachments : null,
          // The body of a shared contact is its bare number: the marker
          // keeps it out of «Неотвеченные» once the row is all that is left.
          origin:
            message.contact && !opts.doctorDictation ? CONTACT_ORIGIN : null,
          externalId,
          status: "DELIVERED",
        } as never,
      });
      stored = true;
    } catch (e) {
      // Unique violation on (clinicId, externalId) means retry — ignore.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/Unique constraint/i.test(msg)) throw e;
    }

    // «Неотвеченные» (audit G6-03): the thread waits for a person until
    // staff answer. Only for a newly stored message, so a webhook retry of
    // one that was already answered cannot put the thread back in the tab.
    // Best effort: the message is saved, the inbox must still hear of it.
    if (
      stored &&
      inboundNeedsReply({
        text: message.text ?? null,
        hasContact: Boolean(message.contact),
        doctorDictation: opts.doctorDictation,
      })
    ) {
      await markAwaitingReply(prisma, conv.id, now).catch((markErr: unknown) => {
        console.warn(`[tg:webhook] awaiting-reply mark failed`, markErr);
      });
    }

    return {
      conversationId: conv.id,
      mode: conv.mode,
      patientId,
      preview,
    };
  });
}

/** Append an OUT message (bot or operator) to Conversation. */
async function recordOutgoing(
  clinicId: string,
  conversationId: string,
  body: string,
  telegramMessageId: number,
): Promise<void> {
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    await prisma.message.create({
      data: {
        clinicId,
        conversationId,
        direction: "OUT",
        body,
        externalId: String(telegramMessageId),
        status: "SENT",
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessageText: previewOf(body),
      },
    });
  });
}

async function handleFsmMessage(
  clinic: TgClinicMinimal,
  chatId: string,
  conversationId: string,
  event: FsmEvent,
  miniAppUrl: string | null,
): Promise<void> {
  const welcome = await readWelcomeConfig(clinic.id);
  const catalog = loadBotCatalog(miniAppUrl, welcome);
  const prev = await loadSnapshot(clinic.id, chatId);
  const { next, outgoing } = step(prev, event, catalog);
  await saveSnapshot(clinic.id, chatId, next);
  if (outgoing) {
    const sent = await sendMessage(clinic, chatId, outgoing.text, {
      reply_markup: outgoing.replyMarkup,
    });
    await recordOutgoing(clinic.id, conversationId, outgoing.text, sent.message_id);
  }
}

/**
 * The language an identity reply goes out in: the card the sender's account
 * is bound to, else his Telegram app language.
 */
async function senderLang(
  clinicId: string,
  from: TgUser | undefined,
): Promise<BotLang> {
  const card = from?.id
    ? await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.patient.findFirst({
          where: { clinicId, telegramId: String(from.id) },
          select: { preferredLang: true },
        }),
      )
    : null;
  return card?.preferredLang === "UZ" ||
    (!card && (from?.language_code ?? "").toLowerCase().startsWith("uz"))
    ? "uz"
    : "ru";
}

/**
 * The sender's account was just bound to a card: move this chat (and the
 * threads of a retired auto card) onto it. Best-effort: the patient still
 * hears that his number was confirmed.
 */
async function attachThreadBestEffort(
  clinic: TgClinicMinimal,
  conversationId: string,
  linked: { patientId: string; retiredPatientId?: string | null },
): Promise<void> {
  try {
    await runWithTenant({ kind: "SYSTEM" }, () =>
      attachThreadToLinkedCard(prisma, {
        clinicId: clinic.id,
        conversationId,
        patientId: linked.patientId,
        retiredPatientId: linked.retiredPatientId ?? null,
      }),
    );
  } catch (attachErr) {
    console.warn(
      `[tg:webhook clinic=${clinic.slug}] thread relink failed`,
      attachErr,
    );
  }
}

/**
 * A contact shared into the bot chat (the Mini App's «Подтвердить номер»
 * calls `requestContact`, which posts the account's own contact here).
 * Applies it as verified identity and tells the patient what happened, in
 * the language of his card.
 */
async function handleSharedContact(
  clinic: TgClinicMinimal,
  chatId: string,
  conversationId: string,
  msg: TgIncomingMessage,
): Promise<void> {
  // An invite this account opened is waiting for exactly this: the account's
  // own number, checked against the invited card (audit PT-04).
  const pending = msg.from?.id
    ? await findPendingInviteClaim({
        clinicId: clinic.id,
        telegramId: String(msg.from.id),
      })
    : null;
  if (pending && msg.from?.id) {
    const invite = await consumeInviteToken({
      clinicId: clinic.id,
      token: pending.token,
      telegramId: String(msg.from.id),
      telegramUsername: msg.from.username ?? null,
      contact: msg.contact,
    });
    console.info(
      `[tg:webhook clinic=${clinic.slug}] invite contact → ${invite.kind}`,
    );
    if (invite.kind === "linked") {
      // The invite bound the account: this chat is the card's thread now,
      // and so is every thread of the auto card it left behind (TG-11).
      await attachThreadBestEffort(clinic, conversationId, invite);
      await bumpPatientLastContact(invite.patientId);
    }
    const inviteText = botT(pending.lang, inviteReplyKey(invite));
    // Keep the «send my number» button up while the patient can still act on
    // it (a forwarded contact, or a number reception is about to correct).
    const retry = invite.kind === "phone-required" || invite.kind === "phone-mismatch";
    const sentInvite = await sendMessage(clinic, chatId, inviteText, {
      reply_markup: retry
        ? sharePhoneKeyboard(pending.lang)
        : { remove_keyboard: true },
    });
    await recordOutgoing(clinic.id, conversationId, inviteText, sentInvite.message_id);
    return;
  }

  const result = await applyVerifiedContact({
    clinicId: clinic.id,
    fromId: msg.from?.id,
    fromUsername: msg.from?.username ?? null,
    contact: msg.contact,
  });
  console.info(`[tg:webhook clinic=${clinic.slug}] contact → ${result.kind}`);
  if (result.kind === "linked") {
    // The account moved to the clinic's card: so does this chat, and every
    // thread of the auto card it left behind (audit TG-11).
    await attachThreadBestEffort(clinic, conversationId, result);
  }
  const lang = await senderLang(clinic.id, msg.from);
  const text = botT(lang, contactReplyKey(result));
  const sent = await sendMessage(clinic, chatId, text);
  await recordOutgoing(clinic.id, conversationId, text, sent.message_id);
}

/** The deep-link payload of `/start <payload>`, or null for anything else. */
function startPayloadOf(text: string | undefined): string | null {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed.startsWith("/start ")) return null;
  return trimmed.slice("/start ".length).trim() || null;
}

/**
 * `/start <token>` from the invite deep link: the QR in the doctor's
 * cabinet and the one printed on every conclusion.
 *
 * Identity, not chat (audit TG-07): it is handled whatever the bot's
 * auto-reply flag and the thread's takeover mode. It used to sit behind that
 * early exit, and with the flag unset (the production default) no QR ever
 * did anything: the doctor's «Привязать Telegram» dialog polled forever and
 * reminders piled up as «нет канала». The flag only decides whether the FSM
 * greets.
 *
 * Opening the link binds nothing yet (audit PT-04): the account is noted as
 * the one that opened it and asked for its own number, and the card is bound
 * when that contact arrives and matches (see handleSharedContact).
 *
 * Returns true when the bot asked for the number, so the FSM welcome does
 * not bury the share button. Never throws: a failure here must not cost the
 * patient his message in the inbox.
 */
async function handleInviteStart(
  clinic: TgClinicMinimal,
  chatId: string,
  conversationId: string,
  msg: TgIncomingMessage,
  token: string,
): Promise<boolean> {
  if (!msg.from?.id) return false;
  let claim: InviteClaimResult;
  try {
    claim = await claimInviteToken({
      clinicId: clinic.id,
      token,
      telegramId: String(msg.from.id),
    });
  } catch (claimErr) {
    console.warn(
      `[tg:webhook clinic=${clinic.slug}] invite claim threw`,
      claimErr,
    );
    return false;
  }
  console.info(
    `[tg:webhook clinic=${clinic.slug}] invite claim → ${claim.kind}`,
  );

  const replyKey = inviteClaimReplyKey(claim);
  if (!replyKey) return false;
  try {
    // The invited card's language when the token names one, else the
    // sender's own (an expired link resolves no card).
    const lang: BotLang =
      "lang" in claim ? claim.lang : await senderLang(clinic.id, msg.from);
    const text = botT(lang, replyKey);
    const sent = await sendMessage(
      clinic,
      chatId,
      text,
      claim.kind === "claimed"
        ? { reply_markup: sharePhoneKeyboard(lang) }
        : undefined,
    );
    await recordOutgoing(clinic.id, conversationId, text, sent.message_id);
  } catch (replyErr) {
    console.warn(
      `[tg:webhook clinic=${clinic.slug}] invite reply failed`,
      replyErr,
    );
  }
  return claim.kind === "claimed";
}

/** One big «📱 send my number» button: Telegram asks, the patient confirms. */
function sharePhoneKeyboard(lang: "ru" | "uz") {
  return {
    keyboard: [[{ text: botT(lang, "invite.shareButton"), request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

/** Mini App URL served by this deployment for a given clinic, or null if
 * the public origin couldn't be determined. Telegram requires HTTPS for
 * `web_app` buttons, so we bail out on plain HTTP.
 *
 * Resolution order:
 *   1. `PUBLIC_BASE_URL` env — explicit override (prod, staging).
 *   2. `x-forwarded-proto` + `x-forwarded-host` — set by proxies (Cloudflare,
 *      nginx, cloudflared tunnel). Without this the dev flow via tunnel
 *      would see `request.url = http://localhost:3000` and never qualify.
 *   3. `new URL(request.url).origin` — last resort.
 */
function resolveMiniAppUrl(request: NextRequest, slug: string): string | null {
  const envBase = process.env.PUBLIC_BASE_URL;
  if (envBase) {
    return envBase.startsWith("https://") ? `${envBase}/c/${slug}/my` : null;
  }
  const fwdProto = request.headers.get("x-forwarded-proto");
  const fwdHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (fwdProto && fwdHost) {
    if (fwdProto !== "https") return null;
    return `https://${fwdHost}/c/${slug}/my`;
  }
  const origin = new URL(request.url).origin;
  if (!origin.startsWith("https://")) return null;
  return `${origin}/c/${slug}/my`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
): Promise<Response> {
  const { clinicSlug } = await params;

  const clinic = await loadClinicBySlug(clinicSlug);
  if (!clinic) return jsonResponse({ error: "Clinic not found" }, 404);

  const providedSecret =
    request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const expected = clinic.tgWebhookSecret ?? "";
  if (!expected || !safeEqual(providedSecret, expected)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return jsonResponse({ ok: true }); // malformed — swallow
  }

  const clinicMin: TgClinicMinimal = {
    id: clinic.id,
    slug: clinic.slug,
    tgBotToken: clinic.tgBotToken,
    tgBotUsername: clinic.tgBotUsername,
  };

  const miniAppUrl = resolveMiniAppUrl(request, clinic.slug);

  try {
    // ─ message ───────────────────────────────────────────────────────────
    if (update.message) {
      const msg = update.message;
      const chatId = String(msg.chat.id);
      // Phase 15 Wave 5 — voice/audio from a doctor → SOAP draft pipeline.
      // Who sent it is settled BEFORE recording: a dictation must not be
      // re-hosted as a playable attachment in the shared inbox. Anyone else's
      // voice note is ordinary chat and is ingested as media (audit TG-01).
      const voiceLike = msg.voice ?? msg.audio ?? null;
      const dictatingDoctor =
        voiceLike && msg.from?.id
          ? await resolveDictatingDoctor(clinic.id, String(msg.from.id))
          : null;
      const recorded = await recordIncoming(
        { ...clinicMin, tgWebhookSecret: clinic.tgWebhookSecret },
        chatId,
        msg,
        { doctorDictation: dictatingDoctor !== null },
      );
      if (recorded.patientId) {
        await bumpPatientLastContact(recorded.patientId);
      }
      if (voiceLike && msg.from?.id && dictatingDoctor) {
        await handleDoctorVoice({
          clinic: clinicMin,
          chatId,
          tgUserId: String(msg.from.id),
          voice: { duration: voiceLike.duration, file_id: voiceLike.file_id },
          doctor: dictatingDoctor,
        });
        // Doctor path — we already replied. Skip FSM dispatch but still
        // emit the realtime event so the inbox surfaces the message.
        publishEventSafe(clinic.id, {
          type: "tg.message.new",
          payload: {
            conversationId: recorded.conversationId,
            chatId,
            direction: "IN",
            messageId: String(msg.message_id),
            preview: recorded.preview,
            contactName: null,
          },
        });
        return jsonResponse({ ok: true });
      }

      // Invite deep link: before every early exit below (audit TG-07).
      const startPayload = startPayloadOf(msg.text);
      const askedForPhone = startPayload
        ? await handleInviteStart(
            clinicMin,
            chatId,
            recorded.conversationId,
            msg,
            startPayload,
          )
        : false;

      const contactDisplayName = (() => {
        const full = [msg.from?.first_name, msg.from?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        if (full) return full;
        if (msg.from?.username) return `@${msg.from.username}`;
        return null;
      })();
      publishEventSafe(clinic.id, {
        type: "tg.message.new",
        payload: {
          conversationId: recorded.conversationId,
          chatId,
          direction: "IN",
          messageId: String(msg.message_id),
          preview: recorded.preview,
          contactName: contactDisplayName,
          // Mirror the patient's inbound TG message into their own mini-app
          // chat via the patient-scoped SSE filter.
          patientId: recorded.patientId,
        },
      });

      // A shared contact is identity proof, not chat (audit PH-01). It is
      // handled whatever the bot's auto-reply mode, since the Mini App's
      // «Подтвердить номер» must work while operators run the inbox, and it
      // never reaches the FSM, which would answer it with the welcome.
      if (msg.contact) {
        await handleSharedContact(
          clinicMin,
          chatId,
          recorded.conversationId,
          msg,
        );
        return jsonResponse({ ok: true });
      }

      const autoReplyEnabled = process.env.TG_BOT_AUTOREPLY === "1";
      if (recorded.mode === "takeover" || !autoReplyEnabled) {
        // Do NOT run the FSM; operator will pick up.
        publishEventSafe(clinic.id, {
          type: "tg.takeover.incoming",
          payload: {
            conversationId: recorded.conversationId,
            chatId,
          },
        });
        return jsonResponse({ ok: true });
      }

      // BOT mode: dispatch to FSM. `/start <payload>` greets like a bare
      // `/start` (the FSM's `text === "/start"` check would miss it as
      // plain text); the invite itself was handled above.
      const trimmedText =
        typeof msg.text === "string" ? msg.text.trim() : null;
      let event: FsmEvent;
      if (trimmedText === "/start") {
        event = { kind: "start" };
      } else if (startPayload) {
        event = { kind: "start", payload: startPayload };
      } else if (typeof msg.text === "string") {
        event = { kind: "text", text: msg.text };
      } else {
        event = { kind: "start" };
      }

      // The bot just asked for the number (PT-04): a welcome on top of it
      // would bury the share button.
      if (askedForPhone) return jsonResponse({ ok: true });

      await handleFsmMessage(
        clinicMin,
        chatId,
        recorded.conversationId,
        event,
        miniAppUrl,
      );
      return jsonResponse({ ok: true });
    }

    // ─ callback_query ────────────────────────────────────────────────────
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id ? String(cq.message.chat.id) : null;

      // Stage 3.G.2 — confirm-button branch. The T-1d / T-2h reminder
      // attaches an inline keyboard with `callback_data="confirm:<id>"`.
      // Match the exact pattern (whole string, no whitespace) so unrelated
      // future buttons cannot accidentally trip the confirmation path.
      const confirmMatch =
        typeof cq.data === "string" ? /^confirm:(.+)$/.exec(cq.data) : null;
      if (confirmMatch) {
        const appointmentId = confirmMatch[1];
        // Ownership check — only the patient who owns the appointment may
        // confirm it, otherwise a forwarded message could let a third party
        // flip someone else's row. Look up under SYSTEM (no tenant ctx
        // available yet) but scope by clinicId we already authenticated.
        const appt = await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.appointment.findFirst({
            where: { id: appointmentId, clinicId: clinic.id },
            select: {
              id: true,
              clinicId: true,
              patientId: true,
              patient: { select: { telegramId: true } },
            },
          }),
        );

        const senderTgId = cq.from?.id ? String(cq.from.id) : null;
        const patientTgId = appt?.patient?.telegramId ?? null;
        // The patient, or the family member a relative's reminder was
        // relayed to (audit P1D-01): the relative has no chat of their own.
        const ownerMatches =
          !!appt &&
          (await telegramUserMayConfirm({
            clinicId: appt.clinicId,
            patientId: appt.patientId,
            patientTelegramId: patientTgId,
            senderTelegramId: senderTgId,
          }));

        if (!appt) {
          await answerCallbackQuery(
            clinicMin,
            cq.id,
            "Запись не найдена",
            false,
          );
          return jsonResponse({ ok: true });
        }
        if (!ownerMatches) {
          await answerCallbackQuery(
            clinicMin,
            cq.id,
            "Эта запись не ваша",
            true,
          );
          return jsonResponse({ ok: true });
        }

        // Confirm via the single entry point. The helper writes audit, closes
        // any open UNCONFIRMED_24H Action, and fans realtime events. Caller
        // contract: must be inside a `TENANT` runWithTenant.
        const result = await runWithTenant(
          {
            kind: "TENANT",
            clinicId: appt.clinicId,
            userId: "",
            role: "SUPER_ADMIN",
          },
          () =>
            confirmAppointment({
              appointmentId: appt.id,
              clinicId: appt.clinicId,
              actorId: null,
              via: "TG_BUTTON",
            }),
        );

        // Translate the helper's result into a TG toast + a one-shot edit
        // that drops the keyboard so the patient can't double-tap.
        let toast: string;
        let editTo: string | null = null;
        if (result.ok) {
          toast = result.alreadyConfirmed
            ? "Уже подтверждено"
            : "Подтверждено ✅";
          editTo = "✅ Подтверждено · спасибо!";
        } else if (result.reason === "cancelled") {
          toast = "Запись уже отменена";
        } else if (result.reason === "completed") {
          toast = "Запись уже завершена";
        } else {
          toast = "Не получилось";
        }
        await answerCallbackQuery(clinicMin, cq.id, toast, false);

        if (editTo && cq.message?.message_id && chatId) {
          try {
            await editMessageText(
              clinicMin,
              chatId,
              cq.message.message_id,
              editTo,
            );
          } catch (editErr) {
            // Editing is best-effort — the confirm itself already landed.
            console.warn(
              `[tg:webhook clinic=${clinic.slug}] editMessageText after confirm failed: ${(editErr as Error).message}`,
            );
          }
        }
        return jsonResponse({ ok: true });
      }

      // Always ack — prevents Telegram from spamming retries.
      await answerCallbackQuery(clinicMin, cq.id);

      if (!chatId) return jsonResponse({ ok: true });

      // Upsert a conversation for the chat (rare case: callback without
      // a prior message on our side).
      const cqContact = {
        contactFirstName: cq.from.first_name ?? null,
        contactLastName: cq.from.last_name ?? null,
        contactUsername: cq.from.username ?? null,
      };
      const conv = await runWithTenant({ kind: "SYSTEM" }, async () =>
        prisma.conversation.upsert({
          where: {
            clinicId_externalId: { clinicId: clinic.id, externalId: chatId },
          },
          create: {
            clinicId: clinic.id,
            channel: "TG",
            mode: "bot",
            status: "OPEN",
            externalId: chatId,
            lastMessageAt: new Date(),
            lastMessageText: "",
            ...cqContact,
          },
          update: { status: "OPEN", ...cqContact },
          select: { id: true, mode: true },
        }),
      );

      const autoReplyEnabled = process.env.TG_BOT_AUTOREPLY === "1";
      if (conv.mode === "takeover" || !autoReplyEnabled) {
        // Reuse the typed `tg.takeover.incoming` event; the callback data
        // travels through the passthrough fields so operator UI can inspect.
        publishEventSafe(clinic.id, {
          type: "tg.takeover.incoming",
          payload: {
            conversationId: conv.id,
            chatId,
            // `AppEventSchema` payload allows passthrough keys.
            callbackData: cq.data ?? null,
          } as unknown as { conversationId: string; chatId: string },
        });
        return jsonResponse({ ok: true });
      }

      await handleFsmMessage(
        clinicMin,
        chatId,
        conv.id,
        { kind: "callback", data: cq.data ?? "" },
        miniAppUrl,
      );
      return jsonResponse({ ok: true });
    }

    // ─ my_chat_member (block / unblock signal) ──────────────────────────
    // Telegram pushes this when the patient blocks (kicked/left) or restarts
    // (member) the bot in their private chat. We mirror it onto
    // `Patient.tgBlockedAt` so reachability counters stay honest.
    if (update.my_chat_member) {
      const ev = update.my_chat_member;
      const status = ev.new_chat_member?.status;
      const blocked = status === "kicked" || status === "left";
      const unblocked = status === "member";
      if (ev.chat?.type === "private" && ev.from?.id && (blocked || unblocked)) {
        try {
          await runWithTenant({ kind: "SYSTEM" }, async () => {
            const chatId = String(ev.chat.id);
            const patient = await prisma.patient.findFirst({
              where: { clinicId: clinic.id, telegramId: chatId },
              select: { id: true, tgBlockedAt: true },
            });
            if (!patient) return;
            if (blocked && !patient.tgBlockedAt) {
              await prisma.patient.update({
                where: { id: patient.id },
                data: { tgBlockedAt: new Date() },
              });
            } else if (unblocked && patient.tgBlockedAt) {
              await prisma.patient.update({
                where: { id: patient.id },
                data: { tgBlockedAt: null },
              });
            } else {
              return; // already in the desired state — nothing to broadcast
            }
            // Nudge the inbox so the header badge + overview counters refresh.
            const conv = await prisma.conversation.findUnique({
              where: {
                clinicId_externalId: { clinicId: clinic.id, externalId: chatId },
              },
              select: { id: true },
            });
            if (conv) {
              publishEventSafe(clinic.id, {
                type: "tg.conversation.updated",
                payload: { conversationId: conv.id },
              });
            }
          });
        } catch (blockErr) {
          // Best-effort — never let block tracking fail the 200 to Telegram.
          console.warn(
            `[tg:webhook clinic=${clinic.slug}] my_chat_member handling failed: ${(blockErr as Error).message}`,
          );
        }
      }
      return jsonResponse({ ok: true });
    }

    // Silent success for update types we don't process.
    return jsonResponse({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[tg:webhook clinic=${clinic.slug}] error: ${message}`);
    // Still respond 200 to Telegram to avoid retry storms; the error is in logs.
    return jsonResponse({ ok: false, error: "internal" });
  }
}
