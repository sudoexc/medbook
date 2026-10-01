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
import { checkUpload } from "@/server/storage/safe-file";
import { Prisma } from "@/generated/prisma/client";
import { deleteObject, isStubMode, uploadObject } from "@/server/storage/minio";
import { sanitizeOverrides } from "@/server/catalog/clinic-overlay";
import { staffKeyHref } from "@/lib/storage-ref";

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

/**
 * Merge a photo into this clinic's overlay for a global catalog row.
 *
 * Most global drugs have no overlay yet, so the first photo creates one, and
 * that create used to omit the required `createdById` (hidden by an
 * `as never` cast): every first upload for the shared catalog failed with a
 * 500 after the file was already stored (audit CT-13). The overlay's
 * `hideGlobal` also defaults to true, so a create that only set the author
 * would have hidden the drug from every doctor of the clinic. The upsert on
 * the unique key sets both explicitly and cannot race a parallel upload into
 * a duplicate-key error.
 */
async function setOverlayPhoto(
  args: { clinicId: string; userId: string; drugId: string },
  photoUrl: string | null,
): Promise<void> {
  const key = {
    clinicId: args.clinicId,
    entityType: "DRUG" as const,
    entityCode: args.drugId,
  };
  const existing = await prisma.clinicCatalogOverlay.findUnique({
    where: { clinicId_entityType_entityCode: key },
    select: { overridesJson: true },
  });
  // Removing a photo the clinic never had: nothing to store.
  if (!existing && !photoUrl) return;
  const next: Record<string, unknown> = {
    ...(sanitizeOverrides("DRUG", existing?.overridesJson) ?? {}),
  };
  if (photoUrl) next.photoUrl = photoUrl;
  else delete next.photoUrl;
  const overridesJson =
    Object.keys(next).length > 0
      ? (next as Prisma.InputJsonValue)
      : Prisma.JsonNull;

  await prisma.clinicCatalogOverlay.upsert({
    where: { clinicId_entityType_entityCode: key },
    create: {
      ...key,
      // A photo must never hide the drug it illustrates.
      hideGlobal: false,
      overridesJson,
      createdById: args.userId,
    },
    update: { overridesJson, updatedById: args.userId },
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
    const buf = Buffer.from(await file.arrayBuffer());
    // Typed by the bytes, not by the browser's claim: /files serves the
    // stored type straight from storage (audit CD-01).
    const checked = checkUpload(buf, file.type, [...ALLOWED_MIME.keys()]);
    const ext = checked.ok ? ALLOWED_MIME.get(checked.mime) : undefined;
    if (!checked.ok || !ext) {
      return err("PhotoMimeUnsupported", 400, {
        allowed: [...ALLOWED_MIME.keys()],
      });
    }
    const photoMime = checked.mime;

    const filename = `${randomUUID()}.${ext}`;
    let photoUrl: string;
    // Undoes the stored file when the database write below fails, so a
    // refused save leaves no orphan behind in the bucket (CT-13).
    let discardStored: () => Promise<void>;
    if (isStubMode()) {
      const dir = path.join(
        process.cwd(),
        "public",
        "uploads",
        "drugs",
        ctx.clinicId,
      );
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, filename);
      await fs.writeFile(file, buf);
      photoUrl = `/uploads/drugs/${ctx.clinicId}/${filename}`;
      discardStored = () => fs.rm(file, { force: true });
    } else {
      const key = `drugs/${ctx.clinicId}/${id}/${filename}`;
      await uploadObject(undefined, key, buf, photoMime);
      // Stored as our streaming-proxy URL, as the header promises: the
      // bucket's own URL is AccessDenied in a browser, so every pack photo
      // rendered as a broken image (audit CD-02). Rows saved the old way are
      // rewritten by scripts/fix-cd02-drug-photo-urls.ts.
      photoUrl = staffKeyHref(key);
      discardStored = () => deleteObject(undefined, key);
    }

    try {
      if (drug.clinicId) {
        await prisma.drug.update({ where: { id }, data: { photoUrl } });
      } else {
        await setOverlayPhoto(
          { clinicId: ctx.clinicId, userId: ctx.userId, drugId: id },
          photoUrl,
        );
      }
    } catch (e) {
      await discardStored().catch((cleanupErr: unknown) => {
        console.warn(
          `[drug-photo] could not remove the orphaned upload: ${
            cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
          }`,
        );
      });
      throw e;
    }

    await audit(request, {
      action: "drug.photo.upload",
      entityType: "Drug",
      entityId: id,
      meta: { bytes: file.size, mime: photoMime, global: !drug.clinicId },
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
      await setOverlayPhoto(
        { clinicId: ctx.clinicId, userId: ctx.userId, drugId: id },
        null,
      );
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
