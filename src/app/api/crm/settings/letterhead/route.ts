/**
 * POST / DELETE /api/crm/settings/letterhead — Ф0 (TZ-smart-constructor).
 *
 * Clinic letterhead for printed conclusions (`Clinic.letterheadUrl`).
 * Deliberately NOT plan-gated: the letterhead is part of the core printed
 * document, unlike the white-label branding bundle.
 *
 * POST — multipart/form-data with a `letterhead` File (PNG / SVG / JPEG,
 *        ≤512 KB). Stored under `public/uploads/letterhead/<clinicId>/` in
 *        stub mode, or MinIO when configured. Mirrors the branding route
 *        mechanics (manual auth — multipart bypasses createApiHandler).
 *
 * DELETE — clears `letterheadUrl` (prints fall back to the text header).
 *
 * Both audit CLINIC_LETTERHEAD_CHANGED with `{ letterheadUrl }`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { auth } from "@/lib/auth";
import { runWithTenant, type Role, type TenantContext } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err, forbidden } from "@/server/http";
import { isStubMode, uploadObject } from "@/server/storage/minio";

const MAX_LETTERHEAD_BYTES = 512 * 1024; // 512 KB — scanned blanks are heavier than logos
const ALLOWED_MIME = new Set(["image/png", "image/svg+xml", "image/jpeg"]);
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
};

type TenantOnly = Extract<TenantContext, { kind: "TENANT" }>;

function buildCtx(user: {
  id: string;
  role: Role;
  clinicId: string | null;
  impersonation?: { grantId: string; mode: "WRITE" | "VIEW_ONLY" } | null;
}): TenantOnly | null {
  if (!user.clinicId) return null;
  const ctx: TenantOnly = {
    kind: "TENANT",
    clinicId: user.clinicId,
    userId: user.id,
    role: user.role,
  };
  if (user.impersonation) {
    ctx.impersonation = {
      grantId: user.impersonation.grantId,
      mode: user.impersonation.mode,
      superAdminId: user.id,
    };
  }
  return ctx;
}

async function resolveCtx(): Promise<TenantOnly | Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  const user = session.user;
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") return forbidden();
  const ctx = buildCtx({
    id: user.id,
    role: user.role as Role,
    clinicId: user.clinicId,
    impersonation: user.impersonation ?? null,
  });
  if (!ctx) return forbidden();
  if (ctx.impersonation?.mode === "VIEW_ONLY") {
    return Response.json(
      { error: "ViewAsReadOnly", grantId: ctx.impersonation.grantId },
      { status: 403 },
    );
  }
  return ctx;
}

export async function POST(request: Request): Promise<Response> {
  const ctx = await resolveCtx();
  if (ctx instanceof Response) return ctx;

  return runWithTenant(ctx, async () => {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data")) {
      return err("MultipartRequired", 400);
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return err("InvalidForm", 400);
    }
    const file = form.get("letterhead");
    if (!(file instanceof File) || file.size === 0) {
      return err("FileRequired", 400);
    }
    if (file.size > MAX_LETTERHEAD_BYTES) {
      return err("LetterheadTooLarge", 413, { maxBytes: MAX_LETTERHEAD_BYTES });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return err("LetterheadMimeUnsupported", 400, {
        allowed: Array.from(ALLOWED_MIME),
      });
    }

    const ext = MIME_TO_EXT[file.type] ?? "bin";
    const filename = `${randomUUID()}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    let letterheadUrl: string;
    if (isStubMode()) {
      const dir = path.join(
        process.cwd(),
        "public",
        "uploads",
        "letterhead",
        ctx.clinicId,
      );
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), buf);
      letterheadUrl = `/uploads/letterhead/${ctx.clinicId}/${filename}`;
    } else {
      const key = `letterhead/${ctx.clinicId}/${filename}`;
      const uploaded = await uploadObject(undefined, key, buf, file.type);
      letterheadUrl = uploaded.url;
    }

    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: { letterheadUrl },
    });

    await audit(request, {
      action: AUDIT_ACTION.CLINIC_LETTERHEAD_CHANGED,
      entityType: "Clinic",
      entityId: ctx.clinicId,
      meta: { letterheadUrl },
    });

    return ok({ letterheadUrl });
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const ctx = await resolveCtx();
  if (ctx instanceof Response) return ctx;

  return runWithTenant(ctx, async () => {
    const before = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { letterheadUrl: true },
    });
    if (!before) return err("NotFound", 404);
    if (!before.letterheadUrl) return ok({ letterheadUrl: null });

    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: { letterheadUrl: null },
    });

    await audit(request, {
      action: AUDIT_ACTION.CLINIC_LETTERHEAD_CHANGED,
      entityType: "Clinic",
      entityId: ctx.clinicId,
      meta: { letterheadUrl: null },
    });

    return ok({ letterheadUrl: null });
  });
}
