/**
 * Phase 15 Wave 5 — TG voice → SOAP intake handler.
 *
 * Listens for `voice` and `audio` messages, but only acts on them when the
 * sender is an authenticated doctor (User.telegramId == sender.id +
 * role=DOCTOR + active). For everyone else we return null so the regular
 * webhook flow handles the message (record incoming + leave silent).
 *
 * On a doctor voice message:
 *   1. Look up the doctor's most recent OPEN MedicalCase, scoped to the
 *      clinic. If none exists, reply "Нет активного случая" and exit.
 *   2. Resolve the file's TG-hosted URL via `getFile`. The URL is short-
 *      lived (~1h) so we don't persist it.
 *   3. Enqueue `voice-soap-process` with the URL + duration. The worker
 *      transcribes + structures + writes `MedicalCase.soapDraft`.
 *   4. Reply to the doctor: "Получил, расшифровываю…".
 *
 * The bot strings live alongside the existing FSM strings in
 * `messages.ts` to keep the bot's i18n surface single-sourced.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { enqueue } from "@/server/queue";
import {
  JOB_NAME as VOICE_SOAP_JOB,
  QUEUE_NAME as VOICE_SOAP_QUEUE,
  type VoiceSoapJob,
} from "@/server/workers/voice-soap";

import { getFile, buildFileDownloadUrl } from "./bot-api";
import { sendMessage, type TgClinicMinimal } from "./send";
import { t, type BotLang } from "./messages";

export type TgVoiceLike = {
  duration: number;
  file_id: string;
};

type DoctorContext = {
  userId: string;
  doctorId: string;
  lang: BotLang;
};

/**
 * Resolve a TG sender to an authenticated DOCTOR for this clinic, or null
 * when the sender is unknown / not a doctor / inactive.
 */
async function resolveDoctorContext(
  clinicId: string,
  tgUserId: string,
): Promise<DoctorContext | null> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const user = await prisma.user.findFirst({
      where: {
        clinicId,
        telegramId: tgUserId,
        role: "DOCTOR",
        active: true,
      },
      select: {
        id: true,
        doctor: { select: { id: true } },
      },
    });
    if (!user || !user.doctor) return null;
    return {
      userId: user.id,
      doctorId: user.doctor.id,
      lang: "ru" as BotLang,
    };
  });
}

/**
 * Find the doctor's latest OPEN case in this clinic. Returns null when the
 * doctor hasn't opened any.
 */
async function findActiveCaseId(
  clinicId: string,
  doctorId: string,
): Promise<string | null> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const row = await prisma.medicalCase.findFirst({
      where: {
        clinicId,
        primaryDoctorId: doctorId,
        status: "OPEN",
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    return row?.id ?? null;
  });
}

export type HandleDoctorVoiceInput = {
  clinic: TgClinicMinimal;
  chatId: string;
  tgUserId: string;
  voice: TgVoiceLike;
};

export type HandleDoctorVoiceResult =
  | { kind: "not-doctor" }
  | { kind: "no-active-case"; replyText: string }
  | { kind: "queued"; replyText: string; caseId: string };

/**
 * Public entry. Returns `not-doctor` when the sender isn't an authenticated
 * doctor (in which case the webhook should fall through to its normal
 * "record incoming" flow). For doctors, sends the appropriate reply and
 * either enqueues the worker job or surfaces "no active case".
 */
export async function handleDoctorVoice(
  input: HandleDoctorVoiceInput,
): Promise<HandleDoctorVoiceResult> {
  const ctx = await resolveDoctorContext(input.clinic.id, input.tgUserId);
  if (!ctx) return { kind: "not-doctor" };

  const caseId = await findActiveCaseId(input.clinic.id, ctx.doctorId);
  if (!caseId) {
    const replyText = t(ctx.lang, "tgVoiceReply.noActiveCase");
    await sendMessage(input.clinic, input.chatId, replyText).catch((e) => {
      console.warn(`[tg:voice-soap] sendMessage failed: ${(e as Error).message}`);
    });
    return { kind: "no-active-case", replyText };
  }

  // Resolve the TG file URL. We never persist this URL — the worker fetches
  // it once and the bytes are GC'd after the OpenAI call returns.
  let fileUrl: string;
  try {
    if (!input.clinic.tgBotToken) {
      throw new Error("clinic has no tgBotToken");
    }
    const fileResp = await getFile(input.clinic.tgBotToken, input.voice.file_id);
    if (!fileResp.ok) {
      throw new Error(
        `getFile ${fileResp.error_code}: ${fileResp.description}`,
      );
    }
    if (!fileResp.result.file_path) {
      throw new Error("getFile returned no file_path");
    }
    fileUrl = buildFileDownloadUrl(
      input.clinic.tgBotToken,
      fileResp.result.file_path,
    );
  } catch (err) {
    console.error(
      `[tg:voice-soap] getFile failed: ${(err as Error).message}`,
    );
    // Best-effort reply so the doctor isn't left wondering.
    await sendMessage(
      input.clinic,
      input.chatId,
      t(ctx.lang, "tgVoiceReply.received"),
    ).catch(() => {});
    return {
      kind: "no-active-case",
      replyText: t(ctx.lang, "tgVoiceReply.received"),
    };
  }

  const job: VoiceSoapJob = {
    clinicId: input.clinic.id,
    userId: ctx.userId,
    doctorId: ctx.doctorId,
    caseId,
    fileUrl,
    durationSec: Math.max(0, Math.floor(input.voice.duration ?? 0)),
  };
  await enqueue(VOICE_SOAP_QUEUE, VOICE_SOAP_JOB, job);

  const replyText = t(ctx.lang, "tgVoiceReply.received");
  await sendMessage(input.clinic, input.chatId, replyText).catch((e) => {
    console.warn(`[tg:voice-soap] sendMessage failed: ${(e as Error).message}`);
  });

  return { kind: "queued", replyText, caseId };
}
