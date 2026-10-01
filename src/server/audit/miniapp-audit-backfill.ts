/**
 * Repair plan for Mini App audit rows written before `auditMiniApp` (audit
 * G1-03): `clinicId = NULL` and no actor, so the clinic's journal never
 * showed them. Pure, so the rules are pinned by a unit test; the script
 * `scripts/fix-g1-03-miniapp-audit-clinic.ts` reads the rows and applies it.
 *
 * The clinic comes from what the row itself recorded: `meta.clinicId` when
 * it names a real clinic, else the clinic of the patient the row is about
 * (`meta.patientId`, or the entity of a Patient row). The actor is set only
 * when the row says who acted: a row written for a relative
 * (`meta.onBehalfOfPatientId`) names the relative, not the family owner who
 * pressed the button, so its actor stays unknown rather than invented.
 */
import { AUDIT_ACTION } from "@/lib/audit-actions";

/** Every action the Mini App routes wrote through `audit()` before G1-03. */
export const MINIAPP_AUDIT_ACTIONS = [
  AUDIT_ACTION.MINIAPP_DOCUMENT_UPLOADED,
  AUDIT_ACTION.MINIAPP_MESSAGE_SENT,
  AUDIT_ACTION.MARKETING_OPT_OUT_CHANGED,
  AUDIT_ACTION.PATIENT_DELETION_REQUESTED,
  AUDIT_ACTION.PATIENT_DELETION_APPROVED,
  AUDIT_ACTION.PATIENT_DELETION_CANCELLED,
  AUDIT_ACTION.PATIENT_DATA_EXPORT_REQUESTED,
  AUDIT_ACTION.MEDICATION_REMINDER_RESPONDED,
  AUDIT_ACTION.LOW_NPS_RECEIVED,
] as const;

export type OrphanAuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  meta: unknown;
  actorLabel: string | null;
  surface: string | null;
};

export type AuditRowFix = {
  id: string;
  clinicId: string;
  /** Set only when the row says who acted and has no actor yet. */
  actor: { role: "PATIENT"; label: string } | null;
  surface: "MINIAPP" | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function metaOf(row: OrphanAuditRow): Record<string, unknown> {
  return row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
    ? (row.meta as Record<string, unknown>)
    : {};
}

/** The patient the row is about (its clinic is the row's clinic). */
export function rowPatientId(row: OrphanAuditRow): string | null {
  const meta = metaOf(row);
  return str(meta.patientId) ?? (row.entityType === "Patient" ? str(row.entityId) : null);
}

/** The Telegram patient who acted, when the row recorded it. */
export function rowActorPatientId(row: OrphanAuditRow): string | null {
  const meta = metaOf(row);
  if (row.action === AUDIT_ACTION.MINIAPP_DOCUMENT_UPLOADED) {
    return str(meta.actorPatientId) ?? (str(meta.onBehalfOfPatientId) ? null : str(meta.patientId));
  }
  if (row.action === AUDIT_ACTION.MARKETING_OPT_OUT_CHANGED) {
    // The profile is always the owner's own.
    return row.entityType === "Patient" ? str(row.entityId) : null;
  }
  // Written for a relative: `patientId` is hers, the owner is not recorded.
  if (str(meta.onBehalfOfPatientId)) return null;
  return str(meta.patientId);
}

/**
 * The fix for one row, or null when its clinic cannot be told.
 * `knownClinicIds` are the clinics that exist; `patientClinic` maps a
 * patient id to its clinic.
 */
export function planMiniAppAuditFix(
  row: OrphanAuditRow,
  knownClinicIds: ReadonlySet<string>,
  patientClinic: ReadonlyMap<string, string>,
): AuditRowFix | null {
  const meta = metaOf(row);
  const metaClinic = str(meta.clinicId);
  const patientId = rowPatientId(row);
  const clinicId =
    (metaClinic && knownClinicIds.has(metaClinic) ? metaClinic : null) ??
    (patientId ? (patientClinic.get(patientId) ?? null) : null);
  if (!clinicId) return null;
  const actorPatient = row.actorLabel ? null : rowActorPatientId(row);
  return {
    id: row.id,
    clinicId,
    actor: actorPatient ? { role: "PATIENT", label: `patient:${actorPatient}` } : null,
    surface: row.surface ? null : "MINIAPP",
  };
}
