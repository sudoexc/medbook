/**
 * POST /api/crm/dev-tasks/[id]/attachments — add one screenshot to a task.
 *
 * multipart/form-data:
 *   - `file`  the screenshot, at most 10 MB, an image by its BYTES
 *             (`checkUpload` with IMAGE_TYPES; an SVG or HTML «picture» is
 *             refused, audit CD-01);
 *   - `thumb` optional, a small JPEG the browser rendered from it for the
 *             board cards. Only a convenience: a missing or odd preview never
 *             fails the upload, the card then shows the original.
 *
 * Stored under `clinics/<clinicId>/dev-tasks/<taskId>/` in the private
 * bucket and served only by `./[attachmentId]` (never a bucket URL). The
 * author of the task and ADMIN / SUPER_ADMIN may add screenshots, one file
 * per request so a phone's 10 MB screenshot stays under nginx's 25 MB cap.
 */
import { randomUUID } from "node:crypto";

import { createApiHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  DEV_TASK_MAX_ATTACHMENTS,
  DEV_TASK_MAX_BYTES,
  DEV_TASK_ROLES,
  DEV_TASK_THUMB_MAX_BYTES,
  canEditDevTask,
  devTaskFileUrl,
  devTaskFolder,
  parseDevTaskRef,
} from "@/lib/dev-tasks";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { devTaskRefWhere } from "@/server/dev-tasks/board";
import { conflict, err, notFound, ok } from "@/server/http";
import { deleteObject, uploadObject } from "@/server/storage/minio";
import { IMAGE_TYPES, checkUpload } from "@/server/storage/safe-file";

/** Screenshots one person may upload per hour (20 per task, a few tasks). */
const UPLOADS_PER_HOUR = 100;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/avif": "avif",
  "image/bmp": "bmp",
};

function refFromUrl(request: Request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../dev-tasks/[id]/attachments
  return parseDevTaskRef(decodeURIComponent(parts[parts.length - 2] ?? ""));
}

export const POST = createApiHandler(
  { roles: [...DEV_TASK_ROLES] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const ref = refFromUrl(request);
    if (!ref) return notFound();

    const task = await prisma.devTask.findFirst({
      where: devTaskRefWhere(ref),
      select: { id: true, number: true, createdById: true },
    });
    if (!task) return notFound();
    if (!canEditDevTask({ userId: ctx.userId, role: ctx.role }, task)) {
      return err("Forbidden", 403, { reason: "dev_task_author_only" });
    }
    if (!rateLimit(`dev-task-upload:${ctx.userId}`, UPLOADS_PER_HOUR, 3_600_000, "dev-tasks")) {
      return err("TooManyRequests", 429, { reason: "dev_task_rate_limited" });
    }
    const existing = await prisma.devTaskAttachment.count({ where: { taskId: task.id } });
    if (existing >= DEV_TASK_MAX_ATTACHMENTS) {
      return conflict("dev_task_attachment_limit", { max: DEV_TASK_MAX_ATTACHMENTS });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return err("InvalidFormData", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return err("MissingFile", 400);
    if (file.size <= 0) return err("EmptyFile", 400);
    if (file.size > DEV_TASK_MAX_BYTES) {
      return err("FileTooLarge", 413, { maxBytes: DEV_TASK_MAX_BYTES });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Typed by its bytes, never by the browser's claim (audit CD-01).
    const checked = checkUpload(buffer, file.type, IMAGE_TYPES, file.name);
    if (!checked.ok) {
      return err("UnsupportedMime", 415, {
        reason: "mime_not_allowed",
        detected: checked.detected,
      });
    }

    // The preview: a JPEG of at most 512 KB, by its bytes too. Anything
    // else is dropped without a word; the card falls back to the original.
    let thumbBuffer: Buffer | null = null;
    const thumb = form.get("thumb");
    if (thumb instanceof File && thumb.size > 0 && thumb.size <= DEV_TASK_THUMB_MAX_BYTES) {
      const bytes = Buffer.from(await thumb.arrayBuffer());
      if (checkUpload(bytes, thumb.type, ["image/jpeg"]).ok) thumbBuffer = bytes;
    }

    const id = randomUUID();
    const folder = devTaskFolder(ctx.clinicId, task.id);
    const objectKey = `${folder}${id}.${EXT[checked.mime] ?? "img"}`;
    let thumbKey: string | null = thumbBuffer ? `${folder}${id}-thumb.jpg` : null;

    await uploadObject(undefined, objectKey, buffer, checked.mime);
    if (thumbKey && thumbBuffer) {
      try {
        await uploadObject(undefined, thumbKey, thumbBuffer, "image/jpeg");
      } catch (e) {
        // The screenshot is safe in storage; the card just shows it whole.
        console.error("[dev-tasks] preview not stored", { thumbKey, e });
        thumbKey = null;
      }
    }

    let row: { id: string; createdAt: Date };
    try {
      row = await prisma.devTaskAttachment.create({
        data: {
          clinicId: ctx.clinicId,
          taskId: task.id,
          objectKey,
          thumbKey,
          mimeType: checked.mime,
          sizeBytes: file.size,
          uploadedById: ctx.userId,
        },
        select: { id: true, createdAt: true },
      });
    } catch (e) {
      // No row, no way to reach the bytes: take them back rather than leave
      // an orphan in the bucket.
      await Promise.allSettled([
        deleteObject(undefined, objectKey),
        ...(thumbKey ? [deleteObject(undefined, thumbKey)] : []),
      ]);
      throw e;
    }

    await audit(request, {
      action: AUDIT_ACTION.DEV_TASK_ATTACHMENT_ADDED,
      entityType: "DevTask",
      entityId: task.id,
      meta: {
        number: task.number,
        attachmentId: row.id,
        mimeType: checked.mime,
        sizeBytes: file.size,
      },
    });

    return ok(
      {
        id: row.id,
        url: devTaskFileUrl(task.id, row.id),
        thumbUrl: devTaskFileUrl(task.id, row.id, "thumb"),
        mimeType: checked.mime,
        sizeBytes: file.size,
        createdAt: row.createdAt.toISOString(),
      },
      201,
    );
  },
);
