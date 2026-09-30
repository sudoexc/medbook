/**
 * A staff message leaving the CRM chat, off the request path (audit TG-17).
 *
 * POST /api/crm/conversations/[id]/messages used to wait for Telegram inside
 * the request. Over the slow egress (a proxy in front of api.telegram.org)
 * one send took up to two minutes: `tgCallWithBackoff` ran 12 attempts of 8s,
 * retrying even timeouts Telegram may already have delivered, nginx cut the
 * request at 60s with a 504, the operator pressed «Отправить» again and the
 * patient got the same message two or three times.
 *
 * Now the route saves the row QUEUED and answers at once; this module sends
 * it and moves the row to SENT / DELIVERED / FAILED, announcing every step on
 * the realtime bus so the bubble goes clock → tick, or to «Не доставлено»
 * with «Повторить».
 *
 *   - `deliverStaffMessage` claims QUEUED→SENDING in one conditional update,
 *     so a duplicate job, the sweep and a retry click can never send twice.
 *     The Telegram call does not repeat a request that may have arrived
 *     (`retryUncertain: false`): no answer means FAILED `tg_timeout`,
 *     «могло дойти», and a person decides whether to send again.
 *   - `enqueueStaffMessage` hands the row to the worker queue (BullMQ in
 *     production). Without Redis, or when Redis refuses the job, the send
 *     runs in this process after the response, never inside it.
 *   - `sweepStaffMessages` (worker, every 20s) re-queues a row whose job
 *     was lost, and closes rows that can no longer go out honestly: QUEUED
 *     for 30 minutes (FAILED `not_sent`, «Повторить» sends it now) or stuck
 *     in SENDING for 15 minutes (FAILED `tg_timeout`).
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { enqueue } from "@/server/queue";
import { publishEventSafe } from "@/server/realtime/publish";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";
import {
  sendDocumentUrl,
  sendMessage,
  sendPhoto,
  type SendMessageOptions,
  type TgDeliveryPolicy,
} from "@/server/telegram/send";
import { tgFailReason } from "@/server/telegram/send-errors";
import {
  adoptTelegramChat,
  clinicBotConnected,
  telegramChatIdFor,
} from "./staff-send";
import { clearAwaitingReply } from "./reply-state";

export const STAFF_SEND_QUEUE = "conversations:send";
export const STAFF_SEND_JOB = "deliver";
export const STAFF_SWEEP_JOB = "sweep";

/** A job older than this without a claim was lost: queue it again. */
export const REQUEUE_AFTER_MS = 15_000;
/** QUEUED this long: too late to go out unasked, «Повторить» sends it now. */
export const QUEUED_EXPIRE_MS = 30 * 60_000;
/**
 * SENDING this long: the worker died mid-send. Far above the longest
 * possible attempt chain (connection retries plus 5xx retries of 30s each).
 */
export const SENDING_STUCK_MS = 15 * 60_000;

/**
 * Staff sends: one attempt per request that may have arrived, and more time
 * per attempt than the bot's 8s, the proxy is slow but usually answers.
 */
const STAFF_DELIVERY: TgDeliveryPolicy = {
  retryUncertain: false,
  attemptTimeoutMs: 30_000,
};

export type StaffSendJob = {
  messageId: string;
  /**
   * Origin of the request that wrote the message: attachments go to Telegram
   * as absolute URLs it fetches. `TG_WEBHOOK_BASE_URL` wins when set, as
   * before; the sweep has no request and falls back to NEXT_PUBLIC_APP_URL.
   */
  publicBase?: string | null;
};

export type StaffSendOutcome =
  | "sent"
  | "delivered_in_app"
  | "failed"
  | "skipped";

type Attachment = { kind: string; url: string };

function attachmentsOf(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is Attachment =>
      Boolean(a) &&
      typeof a === "object" &&
      typeof (a as Attachment).url === "string" &&
      typeof (a as Attachment).kind === "string",
  );
}

function publicBaseFor(job: StaffSendJob): string {
  const base =
    process.env.TG_WEBHOOK_BASE_URL?.replace(/\/+$/, "") ||
    job.publicBase?.replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
    "";
  return base;
}

function absoluteUrl(base: string, u: string): string {
  if (/^https?:\/\//i.test(u)) return u;
  return `${base}${u.startsWith("/") ? u : `/${u}`}`;
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "P2002";
}

/**
 * Why a staff message in this thread cannot go out at all, known without
 * calling Telegram, or null. The route answers these at once (the operator
 * sees «нет Telegram» without waiting for the queue); the worker checks
 * again, since the bot may be disconnected meanwhile.
 */
export function staffSendBlocker(conv: {
  channel: string;
  externalId: string | null;
  patient: { telegramId: string | null } | null;
  clinic: { tgBotToken: string | null };
}): "channel_unavailable" | "bot_not_connected" | "no_telegram" | null {
  // Legacy SMS thread (docs/TZ-sms-removal.md): nothing can carry it.
  if (conv.channel !== "TG") return "channel_unavailable";
  // No bot: send.ts would answer with a made up message id and the row
  // would read SENT (and adopt the chat) while the patient got nothing.
  if (!clinicBotConnected(conv.clinic.tgBotToken)) return "bot_not_connected";
  // A thread the clinic opened from the patient card has no bot chat id
  // yet: a private chat's id is the user's id, so the card's telegramId
  // reaches it (audit TG-04). Neither known: no chat to write to.
  if (!telegramChatIdFor(conv)) return "no_telegram";
  return null;
}

/**
 * Hand a QUEUED staff message to the send worker. Never throws and never
 * waits for Telegram: the caller is an HTTP request.
 */
export async function enqueueStaffMessage(job: StaffSendJob): Promise<void> {
  const inProcess = () => {
    void deliverStaffMessage(job).catch((e: unknown) => {
      console.error(
        `[crm:send] in-process delivery failed msg=${job.messageId}`,
        e,
      );
    });
  };
  // The in-memory queue only reaches workers of this process, and the web
  // process registers none: without Redis, send here, after the response.
  if (!process.env.REDIS_URL) {
    inProcess();
    return;
  }
  try {
    await enqueue(STAFF_SEND_QUEUE, STAFF_SEND_JOB, job);
  } catch (e) {
    console.warn(
      `[crm:send] enqueue failed msg=${job.messageId}, sending in process: ${
        (e as Error).message
      }`,
    );
    inProcess();
  }
}

async function announce(
  clinicId: string,
  row: {
    id: string;
    conversationId: string;
    status: string;
    failedReason: string | null;
  },
  preview: string,
  patientId: string | null,
): Promise<void> {
  publishEventSafe(clinicId, {
    type: "tg.message.new",
    payload: {
      conversationId: row.conversationId,
      messageId: row.id,
      direction: "OUT",
      preview: preview.slice(0, 200),
      patientId,
      // A status change of a message already in the thread: the open chat
      // refetches it, the sender's tab toasts a failure.
      status: row.status,
      failedReason: row.failedReason,
    },
  });
}

/** Send one claimed staff message and record the outcome. */
export async function deliverStaffMessage(
  job: StaffSendJob,
): Promise<StaffSendOutcome> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const claimed = await prisma.message.updateMany({
      where: { id: job.messageId, direction: "OUT", status: "QUEUED" },
      data: { status: "SENDING" },
    });
    if (claimed.count !== 1) return "skipped";

    const msg = await prisma.message.findUnique({
      where: { id: job.messageId },
      select: {
        id: true,
        clinicId: true,
        conversationId: true,
        body: true,
        attachments: true,
        buttons: true,
        createdAt: true,
      },
    });
    if (!msg) return "skipped";
    const conv = await prisma.conversation.findUnique({
      where: { id: msg.conversationId },
      select: {
        id: true,
        channel: true,
        externalId: true,
        patientId: true,
        patient: { select: { telegramId: true } },
        clinic: {
          select: { id: true, slug: true, tgBotToken: true, tgBotUsername: true },
        },
      },
    });

    const attachments = attachmentsOf(msg.attachments);
    const preview = msg.body ?? "";

    const finish = async (
      data:
        | { status: "SENT"; externalId: string | null }
        | { status: "DELIVERED" | "FAILED"; failedReason: string },
    ): Promise<void> => {
      let row: { id: string; conversationId: string; status: string; failedReason: string | null };
      try {
        row = await prisma.message.update({
          where: { id: msg.id },
          data,
          select: { id: true, conversationId: true, status: true, failedReason: true },
        });
      } catch (e) {
        // Telegram numbers messages per chat, but the column is unique per
        // clinic: another chat's message may already hold this number. The
        // patient has the message, so it is SENT all the same.
        if (!(data.status === "SENT" && isUniqueViolation(e))) throw e;
        row = await prisma.message.update({
          where: { id: msg.id },
          data: { status: "SENT" },
          select: { id: true, conversationId: true, status: true, failedReason: true },
        });
      }
      await announce(msg.clinicId, row, preview, conv?.patientId ?? null);
    };

    if (!conv) {
      await finish({ status: "FAILED", failedReason: "not_sent" });
      return "failed";
    }

    const blocker = staffSendBlocker(conv);
    const chatId = telegramChatIdFor(conv);
    if (blocker || !chatId) {
      await finish({ status: "FAILED", failedReason: blocker ?? "no_telegram" });
      return "failed";
    }

    try {
      const inlineKeyboard = Array.isArray(msg.buttons)
        ? (msg.buttons as Array<
            Array<{ text: string; callback_data?: string; url?: string }>
          >)
        : null;
      const replyMarkup: SendMessageOptions = inlineKeyboard
        ? { reply_markup: { inline_keyboard: inlineKeyboard } }
        : {};
      const base = publicBaseFor(job);

      let lastResult: { message_id: number } | null = null;
      if (attachments.length > 0) {
        // Caption rides on the first attachment, the inline keyboard on the
        // last. Images go as photos, everything else as documents by URL.
        for (let i = 0; i < attachments.length; i++) {
          const att = attachments[i]!;
          const isLast = i === attachments.length - 1;
          const caption =
            i === 0 && msg.body && msg.body.length > 0 ? msg.body : undefined;
          const opts: SendMessageOptions = {
            ...(isLast ? replyMarkup : {}),
            delivery: STAFF_DELIVERY,
          };
          const url = absoluteUrl(base, att.url);
          const r =
            att.kind === "image"
              ? await sendPhoto(conv.clinic, chatId, url, caption, opts)
              : await sendDocumentUrl(conv.clinic, chatId, url, caption, opts);
          if (r && typeof r === "object" && "message_id" in r) {
            lastResult = r as { message_id: number };
          }
        }
      } else {
        const sent = await sendMessage(conv.clinic, chatId, msg.body ?? "", {
          ...replyMarkup,
          delivery: STAFF_DELIVERY,
        });
        if (sent && typeof sent === "object" && "message_id" in sent) {
          lastResult = sent as { message_id: number };
        }
      }

      await finish({
        status: "SENT",
        externalId: lastResult ? String(lastResult.message_id) : null,
      });
      if (!conv.externalId) await adoptTelegramChat(conv.id, chatId);
      if (conv.patientId) {
        await bumpPatientLastContact(conv.patientId, new Date());
      }
      await clearAwaitingReply(prisma, conv.id, msg.createdAt);
      return "sent";
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(
        `[crm:send] tg dispatch failed conv=${conv.id} msg=${msg.id}: ${reason}`,
      );
      const failedReason = tgFailReason(reason);
      // «Never pressed Start» on a thread with no bot chat yet is the Mini
      // App in-app chat: the reply is stored and pushed to the Mini App over
      // SSE, so the patient reads it there. That is delivered, not «не
      // доставлено»; the missed DM is kept as the reason. A blocked bot or
      // any other failure stays FAILED (audit TG-04).
      const inAppOnly = !conv.externalId && failedReason === "tg_not_started";
      await finish(
        inAppOnly
          ? { status: "DELIVERED", failedReason }
          : { status: "FAILED", failedReason },
      );
      // Same fallback block signal as the notification worker: reachability
      // counters and broadcast audiences drop the patient.
      if (failedReason === "tg_blocked" && conv.patientId) {
        await prisma.patient
          .updateMany({
            where: {
              id: conv.patientId,
              clinicId: msg.clinicId,
              tgBlockedAt: null,
            },
            data: { tgBlockedAt: new Date() },
          })
          .catch(() => undefined);
      }
      if (inAppOnly) {
        await clearAwaitingReply(prisma, conv.id, msg.createdAt);
        return "delivered_in_app";
      }
      return "failed";
    }
  });
}

/**
 * Close rows matching `where` as FAILED with `failedReason`, one guarded
 * update each so a row the worker claims meanwhile is left alone, and tell
 * the open chats.
 */
async function closeAsFailed(
  where: Record<string, unknown>,
  status: "QUEUED" | "SENDING",
  failedReason: string,
): Promise<number> {
  const rows = await prisma.message.findMany({
    where: { ...where, direction: "OUT", status },
    select: {
      id: true,
      clinicId: true,
      conversationId: true,
      body: true,
      conversation: { select: { patientId: true } },
    },
    take: 200,
  });
  let closed = 0;
  for (const r of rows) {
    const res = await prisma.message.updateMany({
      where: { id: r.id, status },
      data: { status: "FAILED", failedReason },
    });
    if (res.count !== 1) continue;
    closed += 1;
    await announce(
      r.clinicId,
      { id: r.id, conversationId: r.conversationId, status: "FAILED", failedReason },
      r.body ?? "",
      r.conversation?.patientId ?? null,
    );
  }
  return closed;
}

/**
 * Safety net for the queue (worker, every 20s): re-queue lost jobs, close
 * rows that can no longer go out honestly. Idempotent; the claim in
 * `deliverStaffMessage` makes a re-queued row that was in fact picked up a
 * no-op.
 */
export async function sweepStaffMessages(
  now: Date = new Date(),
): Promise<{ requeued: number; expired: number; stuck: number }> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const expireBefore = new Date(now.getTime() - QUEUED_EXPIRE_MS);
    const expired = await closeAsFailed(
      { createdAt: { lt: expireBefore } },
      "QUEUED",
      "not_sent",
    );
    const stuck = await closeAsFailed(
      { createdAt: { lt: new Date(now.getTime() - SENDING_STUCK_MS) } },
      "SENDING",
      "tg_timeout",
    );
    const lost = await prisma.message.findMany({
      where: {
        direction: "OUT",
        status: "QUEUED",
        createdAt: {
          gte: expireBefore,
          lt: new Date(now.getTime() - REQUEUE_AFTER_MS),
        },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const row of lost) {
      await enqueue(STAFF_SEND_QUEUE, STAFF_SEND_JOB, {
        messageId: row.id,
      } satisfies StaffSendJob);
    }
    return { requeued: lost.length, expired, stuck };
  });
}
