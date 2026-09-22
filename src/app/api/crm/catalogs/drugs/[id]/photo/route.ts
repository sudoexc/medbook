/**
 * /api/crm/catalogs/drugs/[id]/photo — packaging photo for a catalog drug.
 *
 * The clinic asked to see what the box looks like, the way a pharmacy site
 * shows it. Scraping someone else's catalog was rejected (their API is
 * robots-disallowed and the imagery is not ours to take), so photos are the
 * clinic's own: an upload of the manufacturer's official pack shot or a
 * snapshot of the box on the shelf.
 *
 * Storage follows the same rule as every other file here: into OUR bucket,
 * served through the streaming proxy — never a hotlink to a third party,
 * which would break the moment they rotate a URL and would leak our traffic
 * to them.
 *
 * Where it lands depends on who owns the row:
 *   - a clinic-owned drug       → `Drug.photoUrl` directly;
 *   - a global catalog row      → the clinic's ClinicCatalogOverlay patch,
 *     so one clinic's photo never shows up in another's catalog.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";
import { isStubMode, uploadObject } from "@/server/storage/minio";
import { sanitizeOverrides } from "@/server/catalog/clinic-overlay";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB — a pack shot, not a scan.
const ALLOWED_MIME = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../drugs/[id]/photo
  return parts[parts.length - 2] ?? "";
}

/** Merge a photo into this clinic's overlay for a global catalog row. */
async function setOverlayPhoto(
  clinicId: string,
  drugId: string,
  photoUrl: string | null,
): Promise<void> {
  const existing = await prisma.clinicCatalogOverlay.findFirst({
    where: { clinicId, entityType: "DRUG", entityCode: drugId },
    select: { id: true, overridesJson: true },
  });
  const current =
    (sanitizeOverrides("DRUG", existing?.overridesJson) as Record<
      string,
      unknown
    > | null) ?? {};
  const next = { ...current };
  if (photoUrl) next.photoUrl = photoUrl;
  else delete next.photoUrl;

  if (existing) {
    await prisma.clinicCatalogOverlay.update({
      where: { id: existing.id },
      data: { overridesJson: next as never },
    });
    return;
  }
  await prisma.clinicCatalogOverlay.create({
    data: {
      clinicId,
      entityType: "DRUG",
      entityCode: drugId,
      overridesJson: next as never,
    } as never,
  });
}

export const POST = createApiHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);

    const drug = await prisma.drug.findFirst({
      where: { id, OR: [{ clinicId: null }, { clinicId: ctx.clinicId }] },
      select: { id: true, clinicId: true },
    });
    if (!drug) return err("NotFound", 404);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return err("InvalidForm", 400);
    }
    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0) {
      return err("PhotoMissing", 400);
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return err("PhotoTooLarge", 413, { maxBytes: MAX_PHOTO_BYTES });
    }
    const ext = ALLOWED_MIME.get(file.type);
    if (!ext) {
      return err("PhotoMimeUnsupported", 400, {
        allowed: [...ALLOWED_MIME.keys()],
      });
    }

    const filename = `${randomUUID()}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    let photoUrl: string;
    if (isStubMode()) {
      const dir = path.join(
        process.cwd(),
        "public",
        "uploads",
        "drugs",
        ctx.clinicId,
      );
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), buf);
      photoUrl = `/uploads/drugs/${ctx.clinicId}/${filename}`;
    } else {
      const key = `drugs/${ctx.clinicId}/${id}/${filename}`;
      const uploaded = await uploadObject(undefined, key, buf, file.type);
      photoUrl = uploaded.url;
    }

    if (drug.clinicId) {
      await prisma.drug.update({ where: { id }, data: { photoUrl } });
    } else {
      await setOverlayPhoto(ctx.clinicId, id, photoUrl);
    }

    await audit(request, {
      action: "drug.photo.upload",
      entityType: "Drug",
      entityId: id,
      meta: { bytes: file.size, mime: file.type, global: !drug.clinicId },
    });
    return ok({ photoUrl });
  },
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);

    const drug = await prisma.drug.findFirst({
      where: { id, OR: [{ clinicId: null }, { clinicId: ctx.clinicId }] },
      select: { id: true, clinicId: true },
    });
    if (!drug) return err("NotFound", 404);

    // The stored object is left in place: it is cheap, and a delete here
    // would race any PDF or chat message already referencing the URL.
    if (drug.clinicId) {
      await prisma.drug.update({ where: { id }, data: { photoUrl: null } });
    } else {
      await setOverlayPhoto(ctx.clinicId, id, null);
    }

    await audit(request, {
      action: "drug.photo.delete",
      entityType: "Drug",
      entityId: id,
      meta: { global: !drug.clinicId },
    });
    return ok({ photoUrl: null });
  },
);
