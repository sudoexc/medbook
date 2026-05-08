/**
 * Phase 17 Wave 3 — Mini App "Скачать мои данные" endpoint.
 *
 * POST /api/miniapp/account/export
 *
 * Creates a DataExportJob in PENDING for the active patient, audits
 * the request, and enqueues the data-export worker to bundle + deliver
 * the bundle via the patient's Telegram chat. Idempotent within a
 * 5-minute window — if the patient already has a recent PENDING /
 * PROCESSING / READY job, returns it unchanged so spamming the button
 * doesn't enqueue duplicate workers.
 *
 * Response: `{ jobId, status }`. The Mini App shows a success toast and
 * tells the patient to watch their Telegram chat — the bundle + the
 * one-time passphrase land in two separate messages from the clinic bot.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";

import { ok, err } from "@/server/http";
import { createMiniAppHandler } from "@/server/miniapp/handler";
import { exportExpiresAt } from "@/server/dsar/expiry";
import { enqueueExportJob } from "@/server/workers/data-export";

const RECENT_WINDOW_MS = 5 * 60 * 1000;

const BodySchema = z.object({}).passthrough().optional();

export const POST = createMiniAppHandler(
  { bodySchema: BodySchema },
  async ({ request, ctx }) => {
    // Telegram chat for delivery — patient's TG id.
    const telegramChatId = ctx.patient.telegramId;
    if (!telegramChatId) {
      return err("no_telegram_chat", 400);
    }

    // Idempotency: reuse a recent active job if one exists.
    const since = new Date(Date.now() - RECENT_WINDOW_MS);
    const recent = await prisma.dataExportJob.findFirst({
      where: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        createdAt: { gte: since },
        status: { in: ["PENDING", "PROCESSING", "READY", "DELIVERED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (recent) {
      return ok({ jobId: recent.id, status: recent.status, reused: true });
    }

    const job = await prisma.dataExportJob.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        status: "PENDING",
        telegramChatId,
        expiresAt: exportExpiresAt(new Date()),
      },
      select: { id: true, status: true },
    });

    await audit(request, {
      action: AUDIT_ACTION.PATIENT_DATA_EXPORT_REQUESTED,
      entityType: "DataExportJob",
      entityId: job.id,
      meta: {
        patientId: ctx.patientId,
        requestedBy: "patient",
      },
    });

    await enqueueExportJob(job.id);

    return ok({ jobId: job.id, status: job.status, reused: false });
  },
);
