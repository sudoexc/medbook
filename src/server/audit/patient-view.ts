/**
 * Phase 17 Wave 1 — PatientView audit helper.
 *
 * Records "user X opened patient Y's PHI in surface Z". The «Просмотры
 * карточек» tab of the audit log is read as the complete list of who looked
 * at a patient's chart, so every read that hands out one patient's medical
 * data writes here (audit G1-06; it used to be three CRM routes, and the
 * doctor, the main reader of the chart, was not in it at all):
 *
 *   CRM
 *   - GET /api/crm/patients/[id]                  → 'patient.detail'
 *   - GET /api/crm/appointments/[id]              → 'appointment.drawer'
 *   - GET /api/crm/cases/[id]                     → 'case.detail'
 *   - GET /api/crm/visit-notes/[id], /previous    → 'visit_note'
 *   - GET /api/crm/visit-notes/[id]/print         → 'visit_note.print'
 *   - GET /api/crm/documents/[id], /documents/file → 'document.file'
 *   - GET /api/crm/conversations/[id]             → 'conversation'
 *   Doctor cabinet
 *   - GET /api/crm/doctors/me/patients/[id]/*     → 'doctor.card'
 *   - GET /api/crm/doctors/me/today (current pt)  → 'doctor.current'
 *   - doctor/visits/[patientId]/[visitId] page    → 'doctor.visit'
 *   Exports
 *   - doctor's per-patient visits CSV             → 'export'
 *   Bulk reads (the patients CSV export, the export worker) cover many
 *   patients at once and write one AuditLog row with the filters and the
 *   row count instead (CRM_EXPORT_REQUESTED / CRM_EXPORT_COMPLETED).
 *   Not here: the patients list and pickers (no medical data in a list row
 *   since PT-11, and a row per keystroke of a search would bury the log),
 *   and chat attachment files (a capability URL Telegram fetches without a
 *   session, so there is no viewer to record).
 *
 * Throttle: a (viewerUserId, patientId, context, contextRef) tuple writes at
 * most one row per 5-minute window, so a re-render storm is one entry while
 * two different visits of the same patient opened in a row are two.
 * We use a DB lookup instead of Redis so the throttle is durable across
 * worker restarts.
 *
 * Failure mode: callers should fire-and-forget. Any throw inside is
 * caught + logged. We never block the originating request on the audit
 * write.
 */
import type { TenantScopedPrisma } from "@/lib/prisma";
import { clientIpForAudit } from "@/lib/client-ip";
import { runWithTenant } from "@/lib/tenant-context";
import type { TenantContext } from "@/lib/tenant-context";
import type { PatientViewContext } from "@/lib/patient-view-contexts";

// Narrowed from `PrismaClient | TenantScopedPrisma` — TS couldn't unify
// overload signatures across extended/raw clients (TS2349). Real callers
// always pass the extended `prisma`; tests would use `as never`.
type PrismaLike = TenantScopedPrisma;

export {
  PATIENT_VIEW_CONTEXTS,
  type PatientViewContext,
} from "@/lib/patient-view-contexts";

const THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

export type RecordPatientViewInput = {
  prisma: PrismaLike;
  clinicId: string;
  viewerUserId: string;
  viewerRole: string;
  patientId: string;
  context: PatientViewContext;
  contextRef?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Insert a PatientView row, honouring the 5-minute throttle. Returns
 * `true` if a row was written, `false` if the throttle suppressed it.
 *
 * Always swallows errors — telemetry must never break the request.
 */
export async function recordPatientView(
  input: RecordPatientViewInput,
): Promise<boolean> {
  try {
    return await runWithTenant({ kind: "SYSTEM" }, async () => {
      const cutoff = new Date(Date.now() - THROTTLE_MS);
      // The (clinicId, viewerUserId, ?, createdAt) index isn't perfectly
      // shaped for this — we'd need (viewerUserId, patientId, context,
      // createdAt) — but the existing (patientId, createdAt) index keeps
      // the lookup bounded for any reasonable patient. Given a single
      // patient surfaces O(seconds) of new views per minute even under
      // heavy use, this is fine.
      const recent = await input.prisma.patientView.findFirst({
        where: {
          clinicId: input.clinicId,
          viewerUserId: input.viewerUserId,
          patientId: input.patientId,
          context: input.context,
          // Two visits of one patient are two reads (audit G1-06).
          contextRef: input.contextRef ?? null,
          createdAt: { gte: cutoff },
        },
        select: { id: true },
      });
      if (recent) return false;

      // Truncate UA to 200 chars per the schema comment / spec.
      const ua = input.userAgent ? input.userAgent.slice(0, 200) : null;
      await input.prisma.patientView.create({
        data: {
          clinicId: input.clinicId,
          viewerUserId: input.viewerUserId,
          viewerRole: input.viewerRole,
          patientId: input.patientId,
          context: input.context,
          contextRef: input.contextRef ?? null,
          ip: input.ip ?? null,
          userAgent: ua,
        },
      });
      return true;
    });
  } catch (err) {
    // Never throw from telemetry. Log + carry on.
    console.error("[patient-view-audit] failed to record view", err);
    return false;
  }
}

/**
 * The route-side call: the viewer from the tenant context, the address and
 * browser from the request. Fire-and-forget like `recordPatientView`; a
 * context that is not a staff member's (none reach /api/crm since PT-05)
 * writes nothing.
 */
export function notePatientView(
  prisma: PrismaLike,
  request: { headers: { get(name: string): string | null } },
  ctx: TenantContext,
  patientId: string | null | undefined,
  context: PatientViewContext,
  contextRef?: string | null,
): void {
  if (ctx.kind !== "TENANT" || !patientId) return;
  void recordPatientView({
    prisma,
    clinicId: ctx.clinicId,
    viewerUserId: ctx.userId,
    viewerRole: ctx.role,
    patientId,
    context,
    contextRef: contextRef ?? null,
    ip: clientIpForAudit(request),
    userAgent: request.headers.get("user-agent"),
  });
}

// Test-only export of the throttle constant so unit tests don't have to
// duplicate the magic number.
export const __INTERNALS__ = { THROTTLE_MS };
