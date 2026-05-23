/**
 * Phase 17 Wave 1 — PatientView audit helper.
 *
 * Records "user X opened patient Y's PHI in surface Z". Wired into:
 *   - server-side patient detail render
 *     (src/app/[locale]/crm/patients/[id]/page.tsx)
 *   - GET /api/crm/appointments/[id]   → context: 'appointment.drawer'
 *   - GET /api/crm/cases/[id]          → context: 'case.detail'
 *   - GET /api/crm/patients/[id]       → context: 'patient.detail'
 *   - export workers (Phase 16+)       → context: 'export'
 *
 * Throttle: a (viewerUserId, patientId, context) tuple writes at most one
 * row per 5-minute window. React re-render storms or rapid drawer
 * open/close cycles thus produce a single audit entry. We use a DB lookup
 * instead of Redis so the throttle is durable across worker restarts.
 *
 * Failure mode: callers should fire-and-forget. Any throw inside is
 * caught + logged. We never block the originating request on the audit
 * write.
 */
import type { TenantScopedPrisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

// Narrowed from `PrismaClient | TenantScopedPrisma` — TS couldn't unify
// overload signatures across extended/raw clients (TS2349). Real callers
// always pass the extended `prisma`; tests would use `as never`.
type PrismaLike = TenantScopedPrisma;

export type PatientViewContext =
  | "patient.detail"
  | "appointment.drawer"
  | "case.detail"
  | "export";

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

// Test-only export of the throttle constant so unit tests don't have to
// duplicate the magic number.
export const __INTERNALS__ = { THROTTLE_MS };
