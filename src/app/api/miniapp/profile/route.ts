/**
 * GET/POST /api/miniapp/profile?clinicSlug=…
 *
 * Read or update the authenticated patient's profile (name, phone, lang).
 * Phone is normalized on the server.
 *
 * Phase 17 Wave 1 — POST also accepts `marketingOptOut: boolean`. Flipping
 * the flag stamps `marketingOptOutAt + marketingOptOutSource = 'mini-app'`
 * and audits MARKETING_OPT_OUT_CHANGED. Backwards compat: callers that
 * still send `consentMarketing` continue to work — the two flags are
 * different (consent = opt-IN, marketingOptOut = opt-OUT).
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { err, ok } from "@/server/http";
import {
  createMiniAppHandler,
  createMiniAppListHandler,
} from "@/server/miniapp/handler";

const Body = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().min(1).max(30).optional(),
    lang: z.enum(["RU", "UZ"]).optional(),
    consentMarketing: z.boolean().optional(),
    marketingOptOut: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.fullName !== undefined ||
      v.phone !== undefined ||
      v.lang !== undefined ||
      v.consentMarketing !== undefined ||
      v.marketingOptOut !== undefined,
    { message: "nothing_to_update" },
  );

export const GET = createMiniAppListHandler({}, async ({ ctx }) => {
  const patient = await prisma.patient.findFirst({
    where: { id: ctx.patientId, clinicId: ctx.clinicId },
    select: {
      id: true,
      fullName: true,
      phone: true,
      phoneNormalized: true,
      preferredLang: true,
      consentMarketing: true,
      marketingOptOut: true,
      telegramUsername: true,
    },
  });
  if (!patient) return err("not_found", 404);
  return ok({
    patient: {
      ...patient,
      hasPhone: !patient.phoneNormalized.startsWith("tg:"),
      phone: patient.phoneNormalized.startsWith("tg:") ? "" : patient.phone,
    },
  });
});

export const POST = createMiniAppHandler({ bodySchema: Body }, async ({ body, ctx, request }) => {
  const data: Record<string, unknown> = {};
  if (body.fullName !== undefined) data.fullName = body.fullName;
  if (body.phone !== undefined) {
    const normalized = normalizePhone(body.phone);
    if (!normalized) return err("bad_phone", 400);
    data.phone = body.phone;
    data.phoneNormalized = normalized;
  }
  if (body.lang !== undefined) data.preferredLang = body.lang;
  if (body.consentMarketing !== undefined) data.consentMarketing = body.consentMarketing;
  // Phase 17 Wave 1 — explicit opt-OUT pathway. Independent from
  // `consentMarketing` (opt-IN flag); both columns coexist on Patient.
  let marketingOptOutChanged = false;
  if (body.marketingOptOut !== undefined) {
    data.marketingOptOut = body.marketingOptOut;
    data.marketingOptOutAt = body.marketingOptOut ? new Date() : null;
    data.marketingOptOutSource = body.marketingOptOut ? "mini-app" : null;
    marketingOptOutChanged = true;
  }
  try {
    const updated = await prisma.patient.update({
      where: { id: ctx.patientId },
      data,
      select: {
        id: true,
        fullName: true,
        phone: true,
        phoneNormalized: true,
        preferredLang: true,
        consentMarketing: true,
        marketingOptOut: true,
      },
    });
    if (marketingOptOutChanged) {
      try {
        await audit(request, {
          action: AUDIT_ACTION.MARKETING_OPT_OUT_CHANGED,
          entityType: "Patient",
          entityId: updated.id,
          meta: {
            source: "mini-app",
            optedOut: updated.marketingOptOut,
          },
        });
      } catch (e) {
        console.error("[miniapp:profile] audit failed", e);
      }
    }
    return ok({
      patient: {
        ...updated,
        hasPhone: !updated.phoneNormalized.startsWith("tg:"),
        phone: updated.phoneNormalized.startsWith("tg:") ? "" : updated.phone,
      },
    });
  } catch (e) {
    const msg = (e as Error).message || "";
    if (msg.includes("Unique")) {
      return err("phone_taken", 409);
    }
    throw e;
  }
});
