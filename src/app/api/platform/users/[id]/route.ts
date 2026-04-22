/**
 * PATCH /api/platform/users/[id] — reassign clinic, change role, deactivate.
 *
 * SUPER_ADMIN only. Demoting oneself is blocked (can't lock the platform).
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err, notFound } from "@/server/http";
import { platformAudit } from "@/server/platform/handler";
import { PatchPlatformUserSchema } from "@/server/schemas/platform";

function idFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/platform/users/[id]
    //  0   1        2      3
    return segs[3] ?? null;
  } catch {
    return null;
  }
}

async function requireSuper(): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: err("Unauthorized", 401) };
  if (session.user.role !== "SUPER_ADMIN") {
    return { ok: false, response: err("Forbidden", 403) };
  }
  return { ok: true, userId: session.user.id };
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = idFromUrl(request);
    if (!id) return err("BadRequest", 400);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return err("InvalidJson", 400);
    }
    const parsed = PatchPlatformUserSchema.safeParse(raw);
    if (!parsed.success) {
      return err("ValidationError", 400, { issues: parsed.error.issues });
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return notFound();

    // Self-protection: can't demote or deactivate yourself.
    if (id === gate.userId) {
      if (parsed.data.active === false) {
        return err("Forbidden", 403, { reason: "cannot_deactivate_self" });
      }
      if (parsed.data.role && parsed.data.role !== "SUPER_ADMIN") {
        return err("Forbidden", 403, { reason: "cannot_demote_self" });
      }
    }

    // If reassigning clinic → validate target clinic exists (or null for SA).
    if (parsed.data.clinicId) {
      const c = await prisma.clinic.findUnique({
        where: { id: parsed.data.clinicId },
        select: { id: true },
      });
      if (!c) return err("NotFound", 404, { reason: "clinic_not_found" });
    }

    // Non-SUPER_ADMIN must have a clinicId — nulling it is only valid for SA.
    const nextRole = parsed.data.role ?? target.role;
    const nextClinicId =
      parsed.data.clinicId === undefined ? target.clinicId : parsed.data.clinicId;
    if (nextRole !== "SUPER_ADMIN" && !nextClinicId) {
      return err("ValidationError", 400, {
        reason: "non_super_admin_requires_clinic",
      });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(parsed.data.clinicId !== undefined
          ? { clinicId: parsed.data.clinicId ?? null }
          : {}),
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        clinicId: true,
      },
    });

    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: updated.clinicId,
      action: "user.update",
      entityType: "User",
      entityId: id,
      meta: {
        changed: Object.keys(parsed.data),
        previousClinicId: target.clinicId,
        previousRole: target.role,
      },
    });

    return ok(updated);
  });
}
