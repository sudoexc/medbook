/**
 * The VIEW_ONLY write block, shared by createApiHandler and the route
 * handlers that cannot sit on it (multipart uploads, CSV and PDF streams,
 * hand rolled 422s).
 *
 * Owner request 09.10.2026 (docs/design/OWNER-ACCOUNT.md §0, §2): the raw
 * POST /api/crm/conversations/[id]/attachments skipped createApiHandler, so a
 * SUPER_ADMIN in a read only visit could still upload into a clinic's chat.
 * Every such route now builds its context with `impersonationStampFor` and
 * calls `assertNotViewOnly` before it reads the body or touches a row: the
 * same 403 body and the same SUPER_ADMIN_VIEW_AS_BLOCKED audit row as the
 * wrapper, from the same code.
 */
import { AUDIT_ACTION } from "./audit-actions";
import { clientIpForAudit } from "./client-ip";
import type { ImpersonationStamp, TenantContext } from "./tenant-context";
import { isViewOnlySafe, viewOnlyBlockResponse } from "./view-only";

type SessionUserLike = {
  id: string;
  role: string;
  clinicId: string | null;
  impersonation?: { grantId: string; mode: "WRITE" | "VIEW_ONLY" } | null;
};

/**
 * The impersonation stamp a TENANT context carries for this session user:
 * set only for a SUPER_ADMIN inside a clinic with a live grant (the session
 * callback puts `impersonation` there only then), null for everyone else.
 * Mirrors `buildContext` in src/lib/api-handler.ts.
 */
export function impersonationStampFor(
  user: SessionUserLike,
): ImpersonationStamp | null {
  if (user.role !== "SUPER_ADMIN" || !user.clinicId || !user.impersonation) {
    return null;
  }
  return {
    grantId: user.impersonation.grantId,
    mode: user.impersonation.mode,
    superAdminId: user.id,
  };
}

/**
 * Best-effort audit row for a blocked write. Audit failure must not turn the
 * 403 into a 500, so exceptions are swallowed and logged.
 */
export async function emitViewAsBlocked(
  request: Request,
  ctx: TenantContext,
): Promise<void> {
  if (ctx.kind !== "TENANT" || !ctx.impersonation) return;
  try {
    const { prisma } = await import("./prisma");
    const url = new URL(request.url);
    await prisma.auditLog.create({
      data: {
        clinicId: ctx.clinicId,
        actorId: ctx.userId,
        actorRole: "SUPER_ADMIN",
        actorLabel: "platform",
        action: AUDIT_ACTION.SUPER_ADMIN_VIEW_AS_BLOCKED,
        entityType: "ImpersonationGrant",
        entityId: ctx.impersonation.grantId,
        meta: {
          method: request.method,
          path: url.pathname,
          clinicId: ctx.clinicId,
        } as never,
        ip: clientIpForAudit(request),
        userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      },
    });
  } catch (e) {
    console.error("[view-only] SUPER_ADMIN_VIEW_AS_BLOCKED audit failed", e);
  }
}

/**
 * The 403 to send when `ctx` is a VIEW_ONLY visit and `request` would write
 * (anything but GET/HEAD/OPTIONS outside /api/platform/session/), after
 * journaling the attempt. Null lets the request go on.
 */
export async function assertNotViewOnly(
  request: Request,
  ctx: TenantContext,
): Promise<Response | null> {
  if (
    ctx.kind !== "TENANT" ||
    ctx.impersonation?.mode !== "VIEW_ONLY" ||
    isViewOnlySafe(request)
  ) {
    return null;
  }
  await emitViewAsBlocked(request, ctx);
  return viewOnlyBlockResponse(ctx.impersonation.grantId);
}
