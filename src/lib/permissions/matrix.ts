/**
 * PERMISSION_MATRIX — declarative description of "who can do what" in the CRM.
 *
 * SOURCE OF TRUTH: this is **documentation, not enforcement**. The actual gates
 * live in:
 *   - `src/lib/api-handler.ts` (role[] option per route)
 *   - role check blocks in `/api/crm/**` route handlers
 *   - Prisma tenant-scope extension in `src/lib/prisma.ts` (clinic / branch)
 *
 * This file exists so the Settings → Roles & Permissions screen can render the
 * current state in one place without scraping route files at runtime. Keep it
 * in sync by hand when permissions change. Editing the matrix UI itself is a
 * Phase 17+ goal (compliance & trust).
 *
 * Audit ST-19: the screen claimed to show the implementation while several
 * cells promised limits the API never had (nurses "today only", doctors
 * "own cases only"). Which roles reach each action is now checked against
 * the `roles` of the routes by tests/unit/st19-permission-matrix-routes.test.ts;
 * the 'own' scopes below are each backed by a check in the route handler.
 *
 * Conventions
 * -----------
 *   read    'all'   — sees all rows in the clinic / branch scope
 *           'own'   — sees only rows linked to themselves (e.g. their patients,
 *                     their appointments, their doctor card)
 *           'today' — restricted to today's slice (no cell uses it today)
 *           'none'  — no read access
 *   write   true / false — can create new rows (POST)
 *   update  'all' / 'own' / 'none' — can update existing rows; 'own' for
 *           DOCTOR editing their own appointments / case notes etc.
 *   delete  true / false — destructive remove / deactivate
 *
 * SUPER_ADMIN is intentionally given `read:'all', write:true, update:'all',
 * delete:true` across the board — they bypass role checks at the
 * `api-handler` layer (see `allowSuperAdmin: true`). Tenant-scoping still
 * applies once they impersonate a clinic.
 */

export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR";

export type ReadScope = "all" | "own" | "today" | "none";
export type UpdateScope = "all" | "own" | "none";

export interface Permission {
  read: ReadScope;
  write: boolean;
  update: UpdateScope;
  delete: boolean;
  /** Soft TODO — set when the cell is a best-effort guess that needs review. */
  unsure?: boolean;
}

export interface ResourcePermissions {
  resource: ResourceKey;
  perRole: Record<Role, Permission>;
}

export type ResourceKey =
  | "Patient"
  | "ClinicalRecord"
  | "PatientAllergy"
  | "Appointment"
  | "Doctor"
  | "Cabinet"
  | "Service"
  | "Payment"
  | "MedicalCase"
  | "NotificationTemplate"
  | "Lead"
  | "Call"
  | "AuditLog"
  | "Settings";

export const ALL_ROLES: Role[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "NURSE",
  "CALL_OPERATOR",
];

const NONE: Permission = { read: "none", write: false, update: "none", delete: false };
const FULL: Permission = { read: "all", write: true, update: "all", delete: true };
/** Everything the routes offer when they offer no DELETE at all. */
const FULL_NO_DELETE: Permission = { read: "all", write: true, update: "all", delete: false };

/** Helper to keep rows compact while still typed. */
function row(
  resource: ResourceKey,
  perRole: Record<Role, Permission>,
): ResourcePermissions {
  return { resource, perRole };
}

export const PERMISSION_MATRIX: ResourcePermissions[] = [
  // ── Patient ──────────────────────────────────────────────────────────────
  // The card itself (/patients, /patients/[id]). The medical record on it is
  // served by its own routes with other roles, so it has the two rows below:
  // a nurse cannot edit the card yet adds and deletes diagnoses (ST-19).
  row("Patient", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: { read: "all", write: true, update: "all", delete: false },
    RECEPTIONIST: { read: "all", write: true, update: "all", delete: false },
    NURSE: { read: "all", write: false, update: "none", delete: false },
    // write — «Создать карточку» for an unknown caller (audit CM-08).
    CALL_OPERATOR: { read: "all", write: true, update: "none", delete: false },
  }),

  // ── ClinicalRecord (diagnoses, chronic conditions, clinical note) ───────
  // /patients/[id]/diagnoses, /chronic-conditions and /clinical-note: the
  // clinical roles only, any patient's record, with a real DELETE.
  row("ClinicalRecord", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: FULL,
    RECEPTIONIST: NONE,
    NURSE: FULL,
    CALL_OPERATOR: NONE,
  }),

  // ── PatientAllergy ──────────────────────────────────────────────────────
  // Kept apart from the record above: the front desk and the call center
  // read allergies (a warning about the patient), they do not write them.
  row("PatientAllergy", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: FULL,
    RECEPTIONIST: { read: "all", write: false, update: "none", delete: false },
    NURSE: FULL,
    CALL_OPERATOR: { read: "all", write: false, update: "none", delete: false },
  }),

  // ── Appointment ──────────────────────────────────────────────────────────
  row("Appointment", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    // write — walk-ins only, and only into their OWN queue: returning patients
    // often walk straight to the office instead of the front desk. The route
    // (`/api/crm/appointments/walkin`) resolves the doctor from the session and
    // rejects any other doctorId, so this cannot become "books for colleagues".
    DOCTOR: { read: "own", write: true, update: "own", delete: false },
    RECEPTIONIST: { read: "all", write: true, update: "all", delete: true },
    // GET /api/crm/appointments narrows only DOCTOR; a nurse reads every
    // visit, not "today" (audit ST-19).
    NURSE: { read: "all", write: false, update: "none", delete: false },
    // update — «Подтвердить» only, through /appointments/[id]/queue-status.
    CALL_OPERATOR: { read: "all", write: true, update: "all", delete: false },
  }),

  // ── Doctor ───────────────────────────────────────────────────────────────
  row("Doctor", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: { read: "all", write: false, update: "own", delete: false },
    RECEPTIONIST: { read: "all", write: false, update: "none", delete: false },
    NURSE: { read: "all", write: false, update: "none", delete: false },
    CALL_OPERATOR: { read: "all", write: false, update: "none", delete: false },
  }),

  // ── Cabinet ──────────────────────────────────────────────────────────────
  row("Cabinet", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: { read: "all", write: false, update: "none", delete: false },
    RECEPTIONIST: { read: "all", write: false, update: "none", delete: false },
    NURSE: { read: "all", write: false, update: "none", delete: false },
    CALL_OPERATOR: { read: "all", write: false, update: "none", delete: false },
  }),

  // ── Service ──────────────────────────────────────────────────────────────
  row("Service", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: { read: "all", write: false, update: "none", delete: false },
    RECEPTIONIST: { read: "all", write: false, update: "none", delete: false },
    NURSE: { read: "all", write: false, update: "none", delete: false },
    CALL_OPERATOR: { read: "all", write: false, update: "none", delete: false },
  }),

  // ── Payment ──────────────────────────────────────────────────────────────
  // No DELETE route: a payment is marked refunded through PATCH, not removed.
  row("Payment", {
    SUPER_ADMIN: FULL_NO_DELETE,
    ADMIN: FULL_NO_DELETE,
    // Any patient's payments, one patient at a time (`patientId` required),
    // the same guard as the call center: not "own" (audit ST-19).
    DOCTOR: { read: "all", write: false, update: "none", delete: false },
    RECEPTIONIST: { read: "all", write: true, update: "all", delete: false },
    NURSE: NONE,
    CALL_OPERATOR: { read: "all", write: false, update: "none", delete: false },
  }),

  // ── MedicalCase ──────────────────────────────────────────────────────────
  // No DELETE (the route answers 405): a case is closed, not removed.
  row("MedicalCase", {
    SUPER_ADMIN: FULL_NO_DELETE,
    ADMIN: FULL_NO_DELETE,
    // The case list and PATCH do not filter by doctor: every case of the
    // clinic, not "own" (audit ST-19).
    DOCTOR: { read: "all", write: true, update: "all", delete: false },
    RECEPTIONIST: { read: "all", write: true, update: "all", delete: false },
    NURSE: { read: "all", write: false, update: "none", delete: false },
    // write — the case a phone booking is filed under (audit CM-08); the
    // clinical fields stay the doctor's.
    CALL_OPERATOR: { read: "all", write: true, update: "none", delete: false },
  }),

  // ── NotificationTemplate ─────────────────────────────────────────────────
  row("NotificationTemplate", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: NONE,
    RECEPTIONIST: { read: "all", write: false, update: "none", delete: false },
    NURSE: NONE,
    CALL_OPERATOR: { read: "all", write: false, update: "none", delete: false },
  }),

  // ── Lead (online requests / inbound web bookings) ────────────────────────
  // Requests arrive from the public site; staff only work them (no POST,
  // no DELETE in /api/crm/online-requests).
  row("Lead", {
    SUPER_ADMIN: { read: "all", write: false, update: "all", delete: false },
    ADMIN: { read: "all", write: false, update: "all", delete: false },
    DOCTOR: NONE,
    RECEPTIONIST: { read: "all", write: false, update: "all", delete: false },
    NURSE: NONE,
    CALL_OPERATOR: { read: "all", write: false, update: "all", delete: false },
  }),

  // ── Call ─────────────────────────────────────────────────────────────────
  // The call log has no DELETE route.
  row("Call", {
    SUPER_ADMIN: FULL_NO_DELETE,
    ADMIN: FULL_NO_DELETE,
    DOCTOR: NONE,
    RECEPTIONIST: { read: "all", write: true, update: "all", delete: false },
    NURSE: NONE,
    CALL_OPERATOR: { read: "all", write: true, update: "all", delete: false },
  }),

  // ── AuditLog ─────────────────────────────────────────────────────────────
  row("AuditLog", {
    SUPER_ADMIN: { read: "all", write: false, update: "none", delete: false },
    ADMIN: { read: "all", write: false, update: "none", delete: false },
    DOCTOR: NONE,
    RECEPTIONIST: NONE,
    NURSE: NONE,
    CALL_OPERATOR: NONE,
  }),

  // ── Settings (clinic info, users, integrations, branches) ────────────────
  // /crm/settings sends every other role back to /crm and the users and
  // integrations APIs are ADMIN-only (audit ST-19). The clinic's name and
  // hours stay readable to all staff for page headers; that is not the
  // settings section.
  row("Settings", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: NONE,
    RECEPTIONIST: NONE,
    NURSE: NONE,
    CALL_OPERATOR: NONE,
  }),
];

/** Look up a permission row; returns `undefined` if the resource is unknown. */
export function getResourcePermissions(
  resource: ResourceKey,
): ResourcePermissions | undefined {
  return PERMISSION_MATRIX.find((r) => r.resource === resource);
}
