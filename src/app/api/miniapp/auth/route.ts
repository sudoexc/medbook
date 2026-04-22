/**
 * POST /api/miniapp/auth
 *
 * First-call entry point for the Telegram Mini App. Verifies the init-data,
 * resolves the clinic by `?clinicSlug=`, then upserts a Patient identified
 * by `telegramId`. Returns the patient profile so the Mini App can prefill
 * forms and pick the UI language.
 *
 * This endpoint intentionally does NOT use `createMiniAppHandler` because the
 * patient row may not exist yet — the wrapper would 428 us out.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { normalizePhone } from "@/lib/phone";
import { err, ok } from "@/server/http";
import { resolveMiniAppContext } from "@/server/miniapp/handler";

const BodySchema = z
  .object({
    phone: z.string().optional(),
    lang: z.enum(["RU", "UZ"]).optional(),
  })
  .partial();

export async function POST(request: Request) {
  const resolved = await resolveMiniAppContext(request, {
    skipPatientUpsert: true,
  });
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  let parsedBody: z.infer<typeof BodySchema> = {};
  try {
    const raw = await request.clone().json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (parsed.success) parsedBody = parsed.data;
  } catch {
    /* body is optional */
  }

  const tgUser = ctx.tgUser;
  const tgIdStr = String(tgUser.id);
  const fullName =
    [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ").trim() ||
    tgUser.username ||
    `TG${tgIdStr}`;

  // Determine language: explicit > existing patient row > TG language_code > RU.
  const codeLang =
    (tgUser.language_code ?? "").toLowerCase().startsWith("uz") ? "UZ" : "RU";
  const desiredLang = parsedBody.lang ?? codeLang;

  const normalizedPhone = parsedBody.phone
    ? normalizePhone(parsedBody.phone)
    : "";

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    // Look for an existing patient by telegramId (preferred) or by
    // phoneNormalized (link on first run if phone was provided).
    let patient = await prisma.patient.findFirst({
      where: { clinicId: ctx.clinicId, telegramId: tgIdStr },
    });
    if (!patient && normalizedPhone) {
      patient = await prisma.patient.findFirst({
        where: {
          clinicId: ctx.clinicId,
          phoneNormalized: normalizedPhone,
        },
      });
      if (patient) {
        patient = await prisma.patient.update({
          where: { id: patient.id },
          data: {
            telegramId: tgIdStr,
            telegramUsername: tgUser.username ?? patient.telegramUsername,
          },
        });
      }
    }
    if (!patient) {
      // Create a minimal patient record — phone can be empty; the client can
      // fill it in via /api/miniapp/profile later.
      try {
        patient = await prisma.patient.create({
          data: {
            clinicId: ctx.clinicId,
            fullName,
            phone: normalizedPhone || `tg:${tgIdStr}`,
            phoneNormalized: normalizedPhone || `tg:${tgIdStr}`,
            telegramId: tgIdStr,
            telegramUsername: tgUser.username ?? null,
            preferredLang: desiredLang,
            source: "TELEGRAM",
            segment: "NEW",
          } as never,
        });
      } catch (e) {
        const msg = (e as Error).message || "";
        if (msg.includes("Unique")) {
          // Race: another call created the row first.
          patient = await prisma.patient.findFirst({
            where: { clinicId: ctx.clinicId, telegramId: tgIdStr },
          });
        }
        if (!patient) return err("create_failed", 500);
      }
    } else if (parsedBody.lang && patient.preferredLang !== parsedBody.lang) {
      patient = await prisma.patient.update({
        where: { id: patient.id },
        data: { preferredLang: parsedBody.lang },
      });
    }
    return ok({
      patient: {
        id: patient.id,
        fullName: patient.fullName,
        phone: patient.phoneNormalized.startsWith("tg:")
          ? ""
          : patient.phoneNormalized,
        preferredLang: patient.preferredLang,
        telegramId: patient.telegramId,
        telegramUsername: patient.telegramUsername,
        hasPhone: !patient.phoneNormalized.startsWith("tg:"),
      },
      clinic: {
        id: ctx.clinicId,
        slug: ctx.clinicSlug,
      },
      tgUser: ctx.tgUser,
    });
  });
}
