import { prisma } from "./prisma";
import { auth } from "./auth";
import { hasValidPin } from "./pin";
import { getTenant } from "./tenant-context";
import { clientIpForAudit } from "./client-ip";

/**
 * Fire-and-forget audit log. Failures are logged to console but never throw —
 * we don't want a dead audit table to break patient-facing flows. If audit
 * logging becomes critical (e.g. for compliance), promote this to a hard
 * dependency at that point.
 */
interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: unknown;
}


export async function audit(request: Request, input: AuditInput): Promise<void> {
  try {
    const session = await auth();
    const viaPin = !session?.user && hasValidPin(request);
    // AuditLog isn't scoped by the tenant extension (it's in
    // MODELS_WITHOUT_TENANT) so we must set clinicId explicitly. Tenant ctx
    // wins; fall back to the session user's clinicId for cases where the
    // call is made before runWithTenant (e.g. login flows).
    const ctx = getTenant();
    const clinicId =
      ctx?.kind === "TENANT"
        ? ctx.clinicId
        : session?.user?.clinicId ?? null;
    await prisma.auditLog.create({
      data: {
        clinicId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        meta: (input.meta ?? null) as never,
        actorId: session?.user?.id ?? null,
        actorRole: session?.user?.role ?? (viaPin ? "TERMINAL" : null),
        actorLabel: session?.user?.email ?? (viaPin ? "terminal" : null),
        // The peer nginx saw; the first X-Forwarded-For hop is client-written
        // and made the audit IP forgeable (audit SEC-03).
        ip: clientIpForAudit(request),
        userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      },
    });
  } catch (err) {
    console.error("[audit]", err);
  }
}

/** The Mini App patient an audited action came from. */
export interface MiniAppAuditActor {
  clinicId: string;
  /** The Telegram-authenticated patient (the family owner, never the relative). */
  patientId: string;
}

/**
 * Audit row for an action a patient took in the Telegram Mini App (audit
 * G1-03).
 *
 * `audit()` finds the clinic in a TENANT context or a staff session. The
 * Mini App has neither: its routes run as SYSTEM and the Telegram WebView
 * carries no NextAuth cookie. So every Mini App row was written with
 * `clinicId = NULL` and no actor, and the clinic's journal (which filters by
 * clinicId) never showed a patient's deletion or export request, upload or
 * consent change. Here both come from the Mini App context, and the actor
 * reads like the outbox rows of the same surface: role PATIENT, label
 * `patient:<id>`, surface MINIAPP. No session is consulted, so a staff
 * cookie in the same browser cannot sign a patient's action.
 */
export async function auditMiniApp(
  request: Request,
  actor: MiniAppAuditActor,
  input: AuditInput,
): Promise<void> {
  try {
    await prisma.auditLog.create({ data: miniAppAuditData(request, actor, input) });
  } catch (err) {
    console.error("[audit:miniapp]", err);
  }
}

/**
 * The row `auditMiniApp` writes, for a route that must write it inside its
 * own transaction: the Mini App upload's row is the account's upload ledger
 * (audit CD-04, `upload-quota.ts`), so it may not be lost the way a
 * fire-and-forget row can.
 */
export function miniAppAuditData(
  request: Request,
  actor: MiniAppAuditActor,
  input: AuditInput,
) {
  return {
    clinicId: actor.clinicId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    meta: (input.meta ?? null) as never,
    actorId: null,
    actorRole: "PATIENT",
    actorLabel: `patient:${actor.patientId}`,
    surface: "MINIAPP",
    ip: clientIpForAudit(request),
    userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
  };
}
