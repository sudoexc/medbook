/**
 * /api/crm/dev-tasks/[id]/attachments/[attachmentId] — one screenshot.
 *
 * GET    — stream the bytes (`?thumb=1`: the small preview when there is
 *          one, else the original). Streamed through the app with the
 *          internal MinIO client for the same reason as the document proxy
 *          (`/api/crm/documents/file`): the bucket is private and a presigned
 *          URL breaks on nginx's `/files/` rewrite. Session-gated to the
 *          board's roles; the row is found through the tenant-scoped client,
 *          so another clinic's screenshot is a 404, and the stored key must
 *          sit in this task's own folder before a byte is read.
 * DELETE — remove a screenshot: the task's author or ADMIN / SUPER_ADMIN.
 *          The row goes first, then the bytes; a storage hiccup leaves an
 *          unreachable object, never a row pointing at nothing.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  DEV_TASK_ROLES,
  canEditDevTask,
  isDevTaskObjectKey,
  parseDevTaskRef,
} from "@/lib/dev-tasks";
import { prisma } from "@/lib/prisma";
import { err, notFound } from "@/server/http";
import { deleteObject, fetchObject } from "@/server/storage/minio";
import { safeFileHeaders } from "@/server/storage/safe-file";

function idsFromUrl(request: Request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../dev-tasks/[id]/attachments/[attachmentId]
  return {
    ref: parseDevTaskRef(decodeURIComponent(parts[parts.length - 3] ?? "")),
    attachmentId: decodeURIComponent(parts[parts.length - 1] ?? ""),
  };
}

/** The attachment, only when it belongs to the task the URL names. */
async function findAttachment(request: Request) {
  const { ref, attachmentId } = idsFromUrl(request);
  if (!ref || !/^[A-Za-z0-9_-]{1,64}$/.test(attachmentId)) return null;
  const row = await prisma.devTaskAttachment.findFirst({
    where: { id: attachmentId },
    select: {
      id: true,
      taskId: true,
      objectKey: true,
      thumbKey: true,
      mimeType: true,
      sizeBytes: true,
      task: { select: { id: true, number: true, createdById: true } },
    },
  });
  if (!row) return null;
  const sameTask = "number" in ref ? row.task.number === ref.number : row.task.id === ref.id;
  return sameTask ? row : null;
}

export const GET = createApiListHandler(
  { roles: [...DEV_TASK_ROLES] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const row = await findAttachment(request);
    if (!row) return notFound();

    const wantsThumb = new URL(request.url).searchParams.get("thumb") === "1";
    const useThumb = wantsThumb && row.thumbKey !== null;
    const key = useThumb ? row.thumbKey! : row.objectKey;
    if (!isDevTaskObjectKey(key, ctx.clinicId, row.taskId)) return err("Forbidden", 403);

    let fetched: Awaited<ReturnType<typeof fetchObject>>;
    try {
      fetched = await fetchObject(undefined, key);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      const name = (e as { name?: string })?.name;
      if (code === "ENOENT" || name === "NoSuchKey") return notFound();
      return err("StorageUnavailable", 502);
    }
    if (!fetched.body) return err("EmptyBody", 502);

    // The type stored on the row, not the one storage reports: stub mode
    // answers octet-stream for everything. Only raster images were accepted,
    // so these preview inline; nosniff and the sandbox CSP still go out.
    const mime = useThumb ? "image/jpeg" : row.mimeType;
    const filename = `task-${row.task.number}-${row.id}${useThumb ? "-thumb" : ""}`;
    return new Response(fetched.body, {
      status: 200,
      headers: {
        ...safeFileHeaders(mime, { filename }),
        // Every upload gets a fresh key and is never rewritten, so a day of
        // browser cache is safe and spares the phone a re-download on every
        // 30-second board refresh.
        "Cache-Control": "private, max-age=86400",
        ...(fetched.contentLength != null
          ? { "Content-Length": String(fetched.contentLength) }
          : {}),
      },
    });
  },
);

export const DELETE = createApiHandler(
  { roles: [...DEV_TASK_ROLES] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const row = await findAttachment(request);
    if (!row) return notFound();
    if (!canEditDevTask({ userId: ctx.userId, role: ctx.role }, row.task)) {
      return err("Forbidden", 403, { reason: "dev_task_author_only" });
    }

    await prisma.devTaskAttachment.deleteMany({ where: { id: row.id } });
    for (const key of [row.objectKey, row.thumbKey]) {
      if (!key || !isDevTaskObjectKey(key, ctx.clinicId, row.taskId)) continue;
      try {
        await deleteObject(undefined, key);
      } catch (e) {
        console.error("[dev-tasks] screenshot bytes not deleted", { key, e });
      }
    }

    await audit(request, {
      action: AUDIT_ACTION.DEV_TASK_ATTACHMENT_REMOVED,
      entityType: "DevTask",
      entityId: row.taskId,
      meta: {
        number: row.task.number,
        attachmentId: row.id,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
      },
    });
    return Response.json({ deleted: true });
  },
);
