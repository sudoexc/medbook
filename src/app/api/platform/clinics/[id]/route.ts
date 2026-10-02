/**
 * GET    /api/platform/clinics/[id] — fetch one clinic.
 * PATCH  /api/platform/clinics/[id] — update editable fields.
 * DELETE /api/platform/clinics/[id] — soft-delete by setting active=false.
 *                                     Hard delete is intentionally not exposed;
 *                                     `Clinic` has cascades on many tables.
 *
 * Every response goes through `CLINIC_VIEW_SELECT` (audit G5-05): the full
 * row carried the Telegram webhook secret, the bot token (plaintext on legacy
 * rows) and the kiosk PIN into the browser, its DevTools and HAR files on each
 * «Активна» toggle. An explicit allow-list also keeps a future secret column
 * from leaking by default.
 *
 * PATCH audits the values before and after (audit G5-10): «changed: [active]»
 * did not say whether the clinic was switched off or on.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err, notFound, diff } from "@/server/http";
import { platformAudit, requireSuperAdmin } from "@/server/platform/handler";
import { UpdateClinicSchema } from "@/server/schemas/platform";

/** What the platform panel may see of a clinic: no credentials. */
const CLINIC_VIEW_SELECT = {
  id: true,
  slug: true,
  nameRu: true,
  nameUz: true,
  addressRu: true,
  addressUz: true,
  phone: true,
  email: true,
  timezone: true,
  currency: true,
  secondaryCurrency: true,
  brandColor: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

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

export async function GET(request: Request): Promise<Response> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    const row = await prisma.clinic.findUnique({
      where: { id },
      select: CLINIC_VIEW_SELECT,
    });
    if (!row) return notFound();
    return ok(row);
  });
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = await requireSuperAdmin();
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
    const before = await prisma.clinic.findUnique({
      where: { id },
      select: CLINIC_VIEW_SELECT,
    });
    if (!before) return notFound();
    const data = {
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
    };
    const updated = await prisma.clinic.update({
      where: { id },
      data,
      select: CLINIC_VIEW_SELECT,
    });
    // Only the fields whose value really moved, e.g. active: true → false.
    const changes = diff(
      before as unknown as Record<string, unknown>,
      data as Record<string, unknown>,
    );
    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: id,
      action: "clinic.update",
      entityType: "Clinic",
      entityId: id,
      meta: {
        changed: Object.keys(changes.after),
        before: changes.before,
        after: changes.after,
      },
    });
    return ok(updated);
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    const row = await prisma.clinic.findUnique({
      where: { id },
      select: CLINIC_VIEW_SELECT,
    });
    if (!row) return notFound();
    const updated = await prisma.clinic.update({
      where: { id },
      data: { active: false },
      select: CLINIC_VIEW_SELECT,
    });
    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: id,
      action: "clinic.deactivate",
      entityType: "Clinic",
      entityId: id,
      meta: { slug: row.slug, before: { active: row.active }, after: { active: false } },
    });
    return ok(updated);
  });
}
