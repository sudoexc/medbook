/**
 * GET / PATCH /api/crm/settings/branding — Phase 19 Wave 4.
 *
 * Plan-gated by `hasWhiteLabel`. Returns 404 (not 403) when the flag is off
 * — same dark-launch pattern as the other gated endpoints.
 *
 * GET — returns the current branding columns plus the resolved feature flag
 *       (so the client can disable the form pre-emptively when the plan was
 *       downgraded between page-load and now).
 *
 * PATCH — accepts EITHER application/json with `{brandColor?, brandSecondaryColor?,
 *       customSubdomain?, logoUrl?}` OR multipart/form-data with the same
 *       fields plus an optional `logo` File (PNG / SVG, ≤256 KB). Writes the
 *       file under `public/uploads/branding/<clinicId>/<uuid>.<ext>` in stub
 *       mode (mirrors the attachments route), or to MinIO when configured.
 *       Audits `BRANDING_CHANGED` with `{changed: string[]}`.
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
import { ensureFeature } from "@/server/platform/feature-guard";
import { isStubMode, uploadObject } from "@/server/storage/minio";
import { UpdateBrandingSchema } from "@/server/schemas/settings";
import { validateSubdomain } from "@/server/platform/subdomain";
import { getFeatureFlags } from "@/server/platform/get-feature-flags";

const MAX_LOGO_BYTES = 256 * 1024; // 256 KB
const ALLOWED_LOGO_MIME = new Set(["image/png", "image/svg+xml"]);
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/svg+xml": "svg",
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

export async function GET(request: Request): Promise<Response> {
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
  return runWithTenant(ctx, async () => {
    const block = await ensureFeature(ctx, "hasWhiteLabel");
    if (block) return block;
    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: {
        logoUrl: true,
        brandColor: true,
        brandSecondaryColor: true,
        customSubdomain: true,
      },
    });
    const flags = await getFeatureFlags(ctx.clinicId);
    return ok({
      ...clinic,
      hasWhiteLabel: flags.hasWhiteLabel,
      hasCustomSubdomain: flags.hasCustomSubdomain,
    });
  });
}

export async function PATCH(request: Request): Promise<Response> {
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

  return runWithTenant(ctx, async () => {
    const block = await ensureFeature(ctx, "hasWhiteLabel");
    if (block) return block;

    // Block VIEW_ONLY impersonation — defence-in-depth (the API wrapper
    // already does this, but this route bypasses createApiHandler because
    // it accepts multipart, so we replicate the check inline).
    if (ctx.impersonation?.mode === "VIEW_ONLY") {
      return Response.json(
        { error: "ViewAsReadOnly", grantId: ctx.impersonation.grantId },
        { status: 403 },
      );
    }

    const before = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: {
        logoUrl: true,
        brandColor: true,
        brandSecondaryColor: true,
        customSubdomain: true,
      },
    });
    if (!before) return err("NotFound", 404);

    let logoUrl: string | null | undefined;
    let bodyJson: unknown = {};
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.startsWith("multipart/form-data")) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return err("InvalidForm", 400);
      }
      const file = form.get("logo");
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_LOGO_BYTES) {
          return err("LogoTooLarge", 413, { maxBytes: MAX_LOGO_BYTES });
        }
        if (!ALLOWED_LOGO_MIME.has(file.type)) {
          return err("LogoMimeUnsupported", 400, {
            allowed: Array.from(ALLOWED_LOGO_MIME),
          });
        }
        const ext = MIME_TO_EXT[file.type] ?? "bin";
        const filename = `${randomUUID()}.${ext}`;
        const buf = Buffer.from(await file.arrayBuffer());
        if (isStubMode()) {
          const dir = path.join(
            process.cwd(),
            "public",
            "uploads",
            "branding",
            ctx.clinicId,
          );
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(path.join(dir, filename), buf);
          logoUrl = `/uploads/branding/${ctx.clinicId}/${filename}`;
        } else {
          const key = `branding/${ctx.clinicId}/${filename}`;
          const uploaded = await uploadObject(undefined, key, buf, file.type);
          logoUrl = uploaded.url;
        }
      }
      // Pull JSON-ish fields off the form. customSubdomain="" → null clear.
      const rawJson: Record<string, unknown> = {};
      for (const k of [
        "brandColor",
        "brandSecondaryColor",
        "customSubdomain",
      ]) {
        const v = form.get(k);
        if (v !== null && typeof v === "string") rawJson[k] = v;
      }
      bodyJson = rawJson;
    } else {
      try {
        bodyJson = await request.json();
      } catch {
        return err("InvalidJson", 400);
      }
    }

    const parsed = UpdateBrandingSchema.safeParse(bodyJson);
    if (!parsed.success) {
      return err("ValidationError", 400, { issues: parsed.error.issues });
    }
    const body = parsed.data;

    // Subdomain plan gate + uniqueness check + reserved-list (the schema
    // already validates format; we enforce server invariants here).
    if (body.customSubdomain !== undefined && body.customSubdomain !== null) {
      const value = body.customSubdomain;
      if (value !== "") {
        const flags = await getFeatureFlags(ctx.clinicId);
        if (!flags.hasCustomSubdomain) {
          return err("plan_required", 403, {
            reason: "Custom subdomain requires Pro or Enterprise plan",
          });
        }
        const valid = validateSubdomain(value);
        if (!valid.ok) {
          return err("InvalidSubdomain", 400, { reason: valid.reason });
        }
        // Uniqueness — Prisma will also throw on collision but a clean
        // message is friendlier.
        const collision = await prisma.clinic.findUnique({
          where: { customSubdomain: valid.value },
          select: { id: true },
        });
        if (collision && collision.id !== ctx.clinicId) {
          return err("SubdomainTaken", 409);
        }
      }
    }

    // Build the update payload only with keys that actually changed.
    const data: Record<string, unknown> = {};
    if (body.brandColor && body.brandColor !== before.brandColor) {
      data.brandColor = body.brandColor;
    }
    if (
      body.brandSecondaryColor !== undefined &&
      body.brandSecondaryColor !== before.brandSecondaryColor
    ) {
      data.brandSecondaryColor = body.brandSecondaryColor;
    }
    if (body.customSubdomain !== undefined) {
      const next = body.customSubdomain === "" ? null : body.customSubdomain;
      if (next !== before.customSubdomain) data.customSubdomain = next;
    }
    if (logoUrl !== undefined && logoUrl !== before.logoUrl) {
      data.logoUrl = logoUrl;
    }

    if (Object.keys(data).length === 0) {
      // No-op write. Return current state without firing an audit row.
      return ok({ ...before });
    }

    const after = await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: data as never,
      select: {
        logoUrl: true,
        brandColor: true,
        brandSecondaryColor: true,
        customSubdomain: true,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.BRANDING_CHANGED,
      entityType: "Clinic",
      entityId: ctx.clinicId,
      meta: { changed: Object.keys(data) },
    });

    return ok(after);
  });
}
