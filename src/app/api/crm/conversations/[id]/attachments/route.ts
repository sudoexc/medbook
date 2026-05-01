/**
 * POST /api/crm/conversations/[id]/attachments — upload an image to send in chat.
 *
 * Accepts multipart/form-data with a single `file` field. Validates that the
 * conversation belongs to the caller's clinic, checks the MIME type and size
 * limit, and writes the bytes to storage.
 *
 * Returns: { url, mimeType, sizeBytes, name }.
 *
 * In stub mode (no MINIO_ENDPOINT) we write under `public/uploads/chat/<clinicId>/`
 * so Next.js serves it back at `/uploads/chat/...` — that URL is what we hand to
 * Telegram's sendPhoto, which means dev only works once the bot can reach the
 * machine (tunnel, deploy, etc.).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { auth } from "@/lib/auth";
import { runWithTenant, type TenantContext, type Role } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound, forbidden } from "@/server/http";
import { isStubMode, uploadObject } from "@/server/storage/minio";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const ALLOWED_ROLES: Role[] = [
  "ADMIN",
  "RECEPTIONIST",
  "DOCTOR",
  "NURSE",
  "CALL_OPERATOR",
];

function conversationIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../conversations/[id]/attachments
  return parts[parts.length - 2] ?? "";
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  const user = session.user;
  if (!ALLOWED_ROLES.includes(user.role) && user.role !== "SUPER_ADMIN") {
    return forbidden();
  }
  if (!user.clinicId) return forbidden();

  const ctx: TenantContext = {
    kind: "TENANT",
    clinicId: user.clinicId,
    userId: user.id,
    role: user.role,
  };

  return runWithTenant(ctx, async () => {
    const conversationId = conversationIdFromUrl(request);
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, clinicId: true },
    });
    if (!conv) return notFound();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return err("InvalidForm", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return err("MissingFile", 400);

    const mime = file.type || "application/octet-stream";
    if (!ALLOWED_MIME.has(mime)) {
      return err("UnsupportedMime", 400, { mimeType: mime });
    }
    if (file.size <= 0) return err("EmptyFile", 400);
    if (file.size > MAX_BYTES) {
      return err("FileTooLarge", 400, { max: MAX_BYTES });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = MIME_TO_EXT[mime] ?? "bin";
    const id = randomUUID();
    const fileName = `${id}.${ext}`;
    const key = `clinics/${conv.clinicId}/chat/${conversationId}/${fileName}`;

    let publicUrl: string;
    if (isStubMode()) {
      const dir = path.join(
        process.cwd(),
        "public",
        "uploads",
        "chat",
        conv.clinicId,
        conversationId,
      );
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, fileName), buffer);
      publicUrl = `/uploads/chat/${conv.clinicId}/${conversationId}/${fileName}`;
    } else {
      const result = await uploadObject(undefined, key, buffer, mime);
      publicUrl = result.url;
    }

    return ok({
      url: publicUrl,
      mimeType: mime,
      sizeBytes: file.size,
      name: file.name || fileName,
    });
  });
}
