/**
 * GET   /api/crm/doctors/me/notification-prefs — read this doctor's matrix
 *                                                (creates default row on miss).
 * PATCH /api/crm/doctors/me/notification-prefs — partial cell-level update.
 *
 * The matrix is event × channel:
 *   events:   appointmentCreated, messageNew, labResultReceived, reminderDue
 *   channels: inApp, email, telegram
 *
 * Each field follows the naming `<event>_<channel>` (see Prisma model). The
 * UI sends ONE cell at a time as the toggle flips — no batched form.
 *
 * Audit: DOCTOR_NOTIFICATION_PREFS_UPDATED with `meta.changed` = the field
 * names. Audit fires on every PATCH (even a single-cell flip) — that's the
 * point: we need a full history of toggles, not just sessions.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err } from "@/server/http";

const FIELDS = [
  "appointmentCreated_inApp",
  "appointmentCreated_email",
  "appointmentCreated_telegram",
  "messageNew_inApp",
  "messageNew_email",
  "messageNew_telegram",
  "labResultReceived_inApp",
  "labResultReceived_email",
  "labResultReceived_telegram",
  "reminderDue_inApp",
  "reminderDue_email",
  "reminderDue_telegram",
] as const;

const PatchBody = z
  .object(
    Object.fromEntries(
      FIELDS.map((f) => [f, z.boolean().optional()]),
    ) as Record<(typeof FIELDS)[number], z.ZodOptional<z.ZodBoolean>>,
  )
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "empty_patch",
  });

async function ensurePref(userId: string) {
  // The migration didn't backfill rows so the first read after deploy lands
  // on `null` — upsert ensures both `GET` and `PATCH` succeed without a
  // pre-existing row. Defaults come from the Prisma model.
  return prisma.doctorNotificationPref.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const pref = await ensurePref(ctx.userId);
    return ok(pref);
  },
);

export const PATCH = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: PatchBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    await ensurePref(ctx.userId);
    const changed: string[] = [];
    const data: Record<string, boolean> = {};
    for (const f of FIELDS) {
      const v = body[f];
      if (typeof v === "boolean") {
        data[f] = v;
        changed.push(f);
      }
    }

    const updated = await prisma.doctorNotificationPref.update({
      where: { userId: ctx.userId },
      data,
    });

    await audit(request, {
      action: AUDIT_ACTION.DOCTOR_NOTIFICATION_PREFS_UPDATED,
      entityType: "User",
      entityId: ctx.userId,
      meta: { changed },
    });

    return ok(updated);
  },
);
