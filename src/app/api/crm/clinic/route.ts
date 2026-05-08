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
import { AUDIT_ACTION } from "@/lib/audit-actions";
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

// Plans that may flip require2faForAll on. Basic must show the toggle as
// disabled with an upsell hint; the API rejects the flip server-side too.
const PLANS_ALLOWING_REQUIRE_2FA = new Set(["pro", "enterprise"]);

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
    });
    if (!clinic) return notFound();
    // Surface the active plan slug so the settings client can plan-gate the
    // require2faForAll toggle in the UI without a second round-trip.
    const sub = await prisma.subscription.findUnique({
      where: { clinicId: ctx.clinicId },
      include: { plan: { select: { slug: true } } },
    });
    const planSlug = sub?.plan.slug ?? "basic";
    return ok({
      ...redactClinic(clinic as unknown as Record<string, unknown>),
      planSlug,
    });
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

    // Phase 17 Wave 2 — plan-gate require2faForAll. We only block when the
    // caller is *enabling* it; turning it back off is always allowed (a
    // clinic that downgraded from Pro→Basic must still be able to clear
    // the flag without an entitlement check).
    if (
      typeof body.require2faForAll === "boolean" &&
      body.require2faForAll === true &&
      before.require2faForAll === false
    ) {
      const sub = await prisma.subscription.findUnique({
        where: { clinicId: ctx.clinicId },
        include: { plan: { select: { slug: true } } },
      });
      const planSlug = sub?.plan.slug ?? "basic";
      if (!PLANS_ALLOWING_REQUIRE_2FA.has(planSlug)) {
        return err("plan_required", 403, {
          reason: "require2faForAll requires Pro or Enterprise plan",
          planSlug,
        });
      }
    }

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

    // Emit dedicated audit rows for the two security toggles when they
    // actually changed, so an auditor scanning by action type does not
    // need to JSON-search the generic `clinic.update` meta.
    if (
      typeof body.require2faForAll === "boolean" &&
      before.require2faForAll !== after.require2faForAll
    ) {
      const sub = await prisma.subscription.findUnique({
        where: { clinicId: ctx.clinicId },
        include: { plan: { select: { slug: true } } },
      });
      await audit(request, {
        action: AUDIT_ACTION.CLINIC_2FA_REQUIREMENT_CHANGED,
        entityType: "Clinic",
        entityId: ctx.clinicId,
        meta: {
          before: before.require2faForAll,
          after: after.require2faForAll,
          planSlug: sub?.plan.slug ?? "basic",
        },
      });
    }
    if (
      typeof body.sessionIdleTimeoutMinutes === "number" &&
      before.sessionIdleTimeoutMinutes !== after.sessionIdleTimeoutMinutes
    ) {
      await audit(request, {
        action: AUDIT_ACTION.CLINIC_SESSION_IDLE_CHANGED,
        entityType: "Clinic",
        entityId: ctx.clinicId,
        meta: {
          before: before.sessionIdleTimeoutMinutes,
          after: after.sessionIdleTimeoutMinutes,
        },
      });
    }

    return ok(redactClinic(after as unknown as Record<string, unknown>));
  }
);
