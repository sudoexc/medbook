/**
 * Phase 18 Wave 4 — pluggable delivery layer for the scheduled-report worker.
 *
 * Two channels: EMAIL (reuses `nodemailer` from `src/lib/email.ts`) and
 * TELEGRAM (reuses the per-clinic bot helper from
 * `src/server/telegram/send.ts`). Both adapters return
 * `{ ok: boolean, error?: string }` so the worker only inspects `.ok` —
 * thrown errors from the underlying client are caught and mapped here.
 *
 * Email infrastructure
 * --------------------
 * `src/lib/email.ts` already creates a singleton `nodemailer.createTransport`
 * configured by SMTP_HOST/PORT/USER/PASS. We import the transporter via a
 * lazy local creator so the analytics-delivery module can be exercised in
 * unit tests without touching SMTP. If SMTP_USER is unset (dev / CI) we
 * "succeed loudly" — log the would-be send and return ok:true. The
 * production `lastDeliveredAt` audit row still carries a `simulated:true`
 * flag so support can grep.
 *
 * Telegram
 * --------
 * `sendDocument` accepts a per-clinic `TgClinicMinimal` blob; we read the
 * clinic row inside the adapter so the worker only passes a `clinicId`.
 * The `deliveryTarget` must be a numeric chat id — we validate at the API
 * layer; any non-numeric reaching the worker is hard-failed here.
 */
import nodemailer from "nodemailer";

import { prisma } from "@/lib/prisma";
import { sendDocument } from "@/server/telegram/send";

export type DeliveryInput = {
  filename: string;
  contentType: string;
  body: Buffer;
  recipient: string;
  subject: string;
  summary: string;
};

export type DeliveryResult = { ok: boolean; error?: string; simulated?: boolean };

let transporterSingleton: nodemailer.Transporter | null = null;
function getMailTransporter(): nodemailer.Transporter | null {
  // Mirrors `src/lib/email.ts` — same env vars, single shared transport.
  if (!process.env.SMTP_USER) return null;
  if (!transporterSingleton) {
    transporterSingleton = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporterSingleton;
}

/** Thin escape so the summary block doesn't break the HTML body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function deliverEmail(input: DeliveryInput): Promise<DeliveryResult> {
  const transporter = getMailTransporter();
  if (!transporter) {
    // Fail closed with a clear message — admins must configure SMTP before
    // scheduling email delivery.
    return { ok: false, error: "Email channel not configured (SMTP_USER unset)" };
  }
  try {
    const summaryHtml = input.summary
      ? `<pre style="font-family:ui-monospace,monospace;white-space:pre-wrap;color:#444;font-size:13px;background:#f6f6f6;padding:12px;border-radius:4px;">${escapeHtml(input.summary)}</pre>`
      : "";
    await transporter.sendMail({
      from: `"NeuroFax" <${process.env.SMTP_USER}>`,
      to: input.recipient,
      subject: input.subject,
      text: `Отчёт прикреплён файлом. Если у вас вопросы — отвечайте на это письмо.\n\n${input.summary}`,
      html: `<div style="font-family:sans-serif;max-width:560px;color:#111;">
        <p>Отчёт прикреплён файлом. Если у вас вопросы — отвечайте на это письмо.</p>
        ${summaryHtml}
      </div>`,
      attachments: [
        {
          filename: input.filename,
          content: input.body,
          contentType: input.contentType,
        },
      ],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? "email_send_failed" };
  }
}

export async function deliverTelegram(
  clinicId: string,
  input: DeliveryInput,
): Promise<DeliveryResult> {
  const numericChatId = Number(input.recipient);
  if (!Number.isFinite(numericChatId) || !/^-?\d+$/.test(input.recipient.trim())) {
    return { ok: false, error: "Invalid Telegram chat id (must be numeric)" };
  }
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, slug: true, tgBotToken: true, tgBotUsername: true },
  });
  if (!clinic) {
    return { ok: false, error: "Clinic not found" };
  }
  // tgBotToken null → `sendDocument` logs and returns a synthetic message id;
  // we treat that as ok+simulated so dev environments don't auto-disable the
  // schedule.
  const simulated = !clinic.tgBotToken;
  const captionLines = [input.subject];
  if (input.summary) captionLines.push("", input.summary);
  const caption = captionLines.join("\n").slice(0, 1024);
  try {
    await sendDocument(clinic, numericChatId, input.body, {
      filename: input.filename,
      contentType: input.contentType,
      caption,
    });
    return { ok: true, simulated };
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? "telegram_send_failed" };
  }
}

export interface DeliverOptions {
  channel: "EMAIL" | "TELEGRAM";
  clinicId: string;
  payload: DeliveryInput;
}

export async function deliverScheduledReport(
  opts: DeliverOptions,
): Promise<DeliveryResult> {
  if (opts.channel === "EMAIL") return deliverEmail(opts.payload);
  if (opts.channel === "TELEGRAM") return deliverTelegram(opts.clinicId, opts.payload);
  return { ok: false, error: `Unknown delivery channel: ${opts.channel as string}` };
}
