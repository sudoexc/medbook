/**
 * /api/crm/clinic — read + update the current tenant's clinic record.
 *
 * See docs/TZ.md §10.Фаза 4. ADMIN only for writes; all tenant roles can read.
 *
 * Clinic lives in MODELS_WITHOUT_TENANT so we filter/where manually.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import { UpdateClinicSettingsSchema } from "@/server/schemas/settings";

/** Strip secret-ish fields before returning to the client. */
function redactClinic<T extends Record<string, unknown>>(c: T): T {
  const out = { ...c } as Record<string, unknown>;
  // Mask tokens but keep presence indicator.
  out.tgBotToken = c.tgBotToken ? "***" : null;
  out.tgWebhookSecret = c.tgWebhookSecret ? "***" : null;
  return out as T;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
    });
    if (!clinic) return notFound();
    return ok(redactClinic(clinic as unknown as Record<string, unknown>));
  }
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: UpdateClinicSettingsSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const before = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
    });
    if (!before) return notFound();

    const after = await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: body as never,
    });

    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "clinic.update",
      entityType: "Clinic",
      entityId: ctx.clinicId,
      meta: d,
    });
    return ok(redactClinic(after as unknown as Record<string, unknown>));
  }
);
