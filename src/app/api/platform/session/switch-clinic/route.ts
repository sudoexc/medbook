/**
 * POST /api/platform/session/switch-clinic — set / clear the SUPER_ADMIN
 * clinic-override cookie (and the Phase 19 W4 grant cookie).
 *
 * Body: `{ clinicId: string | null, reason?: string, mode?: "WRITE" | "VIEW_ONLY" }`.
 *   - When `clinicId` is set, `reason` is required (≥4 chars). The handler
 *     mints an `ImpersonationGrant` row (60min lease, default WRITE mode),
 *     sets `admin_clinic_override` (the existing HMAC-signed clinicId
 *     cookie) AND a fresh `admin_grant_id` cookie that downstream guards
 *     read to confirm the grant is still active.
 *   - When `clinicId` is null, the handler reads the active grant cookie,
 *     stamps the row with `endedAt=now, endedReason="user_exit"`, clears
 *     both cookies, and audits `SUPER_ADMIN_IMPERSONATE_ENDED`.
 *
 * Switching from one clinic to another (clinicId set, current grant cookie
 * present) ends the previous grant first ("user_exit") so the audit trail
 * never has two overlapping live grants for the same actor.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err, notFound } from "@/server/http";
import { platformAudit } from "@/server/platform/handler";
import {
  OVERRIDE_COOKIE_NAME,
  signClinicOverride,
} from "@/server/platform/clinic-override";
import {
  GRANT_COOKIE_NAME,
  createGrant,
  endGrant,
  getActiveGrant,
} from "@/server/platform/impersonation";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { SwitchClinicSchema } from "@/server/schemas/platform";

function readGrantCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const needle = `${GRANT_COOKIE_NAME}=`;
  for (const pair of header.split(";")) {
    const trimmed = pair.trim();
    if (trimmed.startsWith(needle)) return trimmed.slice(needle.length) || null;
  }
  return null;
}

function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : "",
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "SUPER_ADMIN") return err("Forbidden", 403);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err("InvalidJson", 400);
  }
  const parsed = SwitchClinicSchema.safeParse(raw);
  if (!parsed.success) {
    return err("ValidationError", 400, { issues: parsed.error.issues });
  }

  const clinicId = parsed.data.clinicId;
  const mode = parsed.data.mode ?? "WRITE";

  return runWithTenant(
    { kind: "SUPER_ADMIN", userId: session.user.id },
    async () => {
      if (clinicId) {
        const reason = parsed.data.reason?.trim();
        if (!reason || reason.length < 4) {
          return err("ValidationError", 400, { reason: "reason_required" });
        }

        const exists = await prisma.clinic.findUnique({
          where: { id: clinicId },
          select: { id: true, slug: true, nameRu: true },
        });
        if (!exists) return notFound();

        // End the previous grant before minting a new one — keeps the audit
        // history linear (a single live grant per actor at any moment).
        const prevGrantId = readGrantCookie(request);
        if (prevGrantId) {
          await endGrant(prevGrantId, "user_exit");
        }

        const grant = await createGrant(
          session.user.id,
          clinicId,
          reason,
          mode,
        );

        const signed = signClinicOverride(clinicId);
        await platformAudit({
          request,
          userId: session.user.id,
          clinicId,
          action: AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_STARTED,
          entityType: "ImpersonationGrant",
          entityId: grant.grantId,
          meta: {
            clinicId,
            slug: exists.slug,
            mode,
            expiresAt: grant.expiresAt.toISOString(),
            reason,
          },
        });

        const headers = new Headers();
        headers.append(
          "set-cookie",
          cookieHeader(OVERRIDE_COOKIE_NAME, signed, 60 * 60 * 12),
        );
        headers.append(
          "set-cookie",
          cookieHeader(GRANT_COOKIE_NAME, grant.grantId, 60 * 60), // 60min, mirrors lease
        );
        return Response.json(
          {
            ok: true,
            clinicId: exists.id,
            slug: exists.slug,
            nameRu: exists.nameRu,
            grantId: grant.grantId,
            mode,
            expiresAt: grant.expiresAt.toISOString(),
          },
          { status: 200, headers },
        );
      }

      // Exit path — clear cookies, end active grant.
      const prevGrantId = readGrantCookie(request);
      let endedClinicId: string | null = null;
      let durationMs: number | null = null;
      if (prevGrantId) {
        const active = await getActiveGrant(prevGrantId).catch(() => null);
        if (active) {
          endedClinicId = active.clinicId;
          durationMs = Date.now() - (active.expiresAt.getTime() - 60 * 60 * 1000);
        }
        await endGrant(prevGrantId, "user_exit");
      }

      await platformAudit({
        request,
        userId: session.user.id,
        clinicId: endedClinicId,
        action: AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_ENDED,
        entityType: "ImpersonationGrant",
        entityId: prevGrantId ?? null,
        meta: {
          clinicId: endedClinicId,
          durationMs,
        },
      });
      const headers = new Headers();
      headers.append(
        "set-cookie",
        cookieHeader(OVERRIDE_COOKIE_NAME, "", 0),
      );
      headers.append("set-cookie", cookieHeader(GRANT_COOKIE_NAME, "", 0));
      return Response.json({ ok: true, clinicId: null }, { status: 200, headers });
    },
  );
}

export async function GET(): Promise<Response> {
  return err("MethodNotAllowed", 405);
}

void ok; // keep import narrow; ok unused here
