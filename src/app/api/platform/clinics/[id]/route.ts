/**
 * GET    /api/platform/clinics/[id] — fetch one clinic.
 * PATCH  /api/platform/clinics/[id] — update editable fields.
 * DELETE /api/platform/clinics/[id] — soft-delete by setting active=false.
 *                                     Hard delete is intentionally not exposed;
 *                                     `Clinic` has cascades on many tables.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err, notFound } from "@/server/http";
import { platformAudit } from "@/server/platform/handler";
import { UpdateClinicSchema } from "@/server/schemas/platform";

function clinicIdFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/platform/clinics/[id]
    //  0   1        2       3
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

export async function GET(request: Request): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    const row = await prisma.clinic.findUnique({ where: { id } });
    if (!row) return notFound();
    return ok(row);
  });
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return err("InvalidJson", 400);
    }
    const parsed = UpdateClinicSchema.safeParse(raw);
    if (!parsed.success) {
      return err("ValidationError", 400, { issues: parsed.error.issues });
    }
    const before = await prisma.clinic.findUnique({ where: { id } });
    if (!before) return notFound();
    const updated = await prisma.clinic.update({
      where: { id },
      data: {
        ...(parsed.data.nameRu !== undefined ? { nameRu: parsed.data.nameRu } : {}),
        ...(parsed.data.nameUz !== undefined ? { nameUz: parsed.data.nameUz } : {}),
        ...(parsed.data.addressRu !== undefined
          ? { addressRu: parsed.data.addressRu ?? null }
          : {}),
        ...(parsed.data.addressUz !== undefined
          ? { addressUz: parsed.data.addressUz ?? null }
          : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone ?? null } : {}),
        ...(parsed.data.email !== undefined ? { email: parsed.data.email ?? null } : {}),
        ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
        ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
        ...(parsed.data.secondaryCurrency !== undefined
          ? { secondaryCurrency: parsed.data.secondaryCurrency ?? null }
          : {}),
        ...(parsed.data.brandColor ? { brandColor: parsed.data.brandColor } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      },
    });
    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: id,
      action: "clinic.update",
      entityType: "Clinic",
      entityId: id,
      meta: { changed: Object.keys(parsed.data) },
    });
    return ok(updated);
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    const row = await prisma.clinic.findUnique({ where: { id } });
    if (!row) return notFound();
    const updated = await prisma.clinic.update({
      where: { id },
      data: { active: false },
    });
    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: id,
      action: "clinic.deactivate",
      entityType: "Clinic",
      entityId: id,
      meta: { slug: row.slug },
    });
    return ok(updated);
  });
}
