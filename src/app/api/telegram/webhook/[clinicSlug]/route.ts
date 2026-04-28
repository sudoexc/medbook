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
 *      only persist and notify operator — the FSM stays silent.
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

import {
  answerCallbackQuery,
  sendMessage,
  type TgClinicMinimal,
} from "@/server/telegram/send";
import {
  type Catalog,
  type FsmEvent,
  loadSnapshot,
  saveSnapshot,
  step,
} from "@/server/telegram/state";
import { publishEventSafe } from "@/server/realtime/publish";

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
type TgIncomingMessage = {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  photo?: unknown;
  voice?: unknown;
  contact?: { phone_number: string; first_name?: string; last_name?: string };
  date: number;
};
type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgIncomingMessage;
  data?: string;
};
type TgUpdate = {
  update_id: number;
  message?: TgIncomingMessage;
  edited_message?: TgIncomingMessage;
  callback_query?: TgCallbackQuery;
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
    return prisma.clinic.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        tgBotToken: true,
        tgBotUsername: true,
        tgWebhookSecret: true,
      },
    });
  });
}

async function loadBotCatalog(
  clinicId: string,
  miniAppUrl: string | null,
): Promise<Catalog> {
  // Short-circuit: when a Mini App URL is available, the FSM sends a single
  // `web_app` button after lang pick — no in-chat service/doctor/slot walks.
  // Skipping the catalog fetch saves a few round-trips per message.
  if (miniAppUrl) {
    return {
      services: [],
      doctorsByService: {},
      slotsByDoctor: {},
      miniAppUrl,
    };
  }
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const services = await prisma.service.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, nameRu: true, nameUz: true },
      take: 20,
      orderBy: { nameRu: "asc" },
    });
    const doctorsByService: Record<
      string,
      Array<{ id: string; nameRu: string; nameUz: string }>
    > = {};
    for (const svc of services) {
      const rows = await prisma.serviceOnDoctor.findMany({
        where: { serviceId: svc.id, doctor: { isActive: true } },
        include: {
          doctor: { select: { id: true, nameRu: true, nameUz: true } },
        },
        take: 10,
      });
      doctorsByService[svc.id] = rows.map((r) => ({
        id: r.doctor.id,
        nameRu: r.doctor.nameRu,
        nameUz: r.doctor.nameUz,
      }));
    }
    // Legacy path (no Mini App configured) — slots remain empty; FSM tells
    // user to call the clinic.
    const slotsByDoctor: Record<string, Array<{ iso: string; label: string }>> = {};
    return {
      services,
      doctorsByService,
      slotsByDoctor,
      miniAppUrl: null,
    };
  });
}

/** Upsert Conversation + append incoming Message. */
async function recordIncoming(
  clinic: TgClinicMinimal & { tgWebhookSecret: string | null },
  chatId: string,
  message: TgIncomingMessage,
): Promise<{ conversationId: string; mode: "bot" | "takeover" }> {
  const body = message.text ?? (message.contact ? message.contact.phone_number : "");
  const now = new Date();
  const contact = {
    contactFirstName: message.from?.first_name ?? null,
    contactLastName: message.from?.last_name ?? null,
    contactUsername: message.from?.username ?? null,
  };

  return runWithTenant({ kind: "SYSTEM" }, async () => {
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
        lastMessageText: previewOf(body),
        unreadCount: 1,
        ...contact,
      },
      update: {
        lastMessageAt: now,
        lastMessageText: previewOf(body),
        unreadCount: { increment: 1 },
        status: "OPEN",
        ...contact,
      },
      select: { id: true, mode: true },
    });

    // Dedupe on (clinicId, externalId) — Telegram may retry a webhook.
    const externalId = String(message.message_id);
    try {
      await prisma.message.create({
        data: {
          clinicId: clinic.id,
          conversationId: conv.id,
          direction: "IN",
          body: body || null,
          externalId,
          status: "DELIVERED",
        },
      });
    } catch (e) {
      // Unique violation on (clinicId, externalId) means retry — ignore.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/Unique constraint/i.test(msg)) throw e;
    }

    return { conversationId: conv.id, mode: conv.mode };
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
  const catalog = await loadBotCatalog(clinic.id, miniAppUrl);
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
      const recorded = await recordIncoming(
        { ...clinicMin, tgWebhookSecret: clinic.tgWebhookSecret },
        chatId,
        msg,
      );
      publishEventSafe(clinic.id, {
        type: "tg.message.new",
        payload: {
          conversationId: recorded.conversationId,
          chatId,
          direction: "IN",
          messageId: String(msg.message_id),
        },
      });

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

      // BOT mode: dispatch to FSM.
      const event: FsmEvent =
        typeof msg.text === "string"
          ? { kind: "text", text: msg.text }
          : { kind: "start" };
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

    // Silent success for update types we don't process.
    return jsonResponse({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[tg:webhook clinic=${clinic.slug}] error: ${message}`);
    // Still respond 200 to Telegram to avoid retry storms; the error is in logs.
    return jsonResponse({ ok: false, error: "internal" });
  }
}
