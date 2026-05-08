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
 * Conventions
 * -----------
 *   read    'all'   — sees all rows in the clinic / branch scope
 *           'own'   — sees only rows linked to themselves (e.g. their patients,
 *                     their appointments, their doctor card)
 *           'today' — restricted to today's slice (NURSE on appointments)
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

/** Helper to keep rows compact while still typed. */
function row(
  resource: ResourceKey,
  perRole: Record<Role, Permission>,
): ResourcePermissions {
  return { resource, perRole };
}

export const PERMISSION_MATRIX: ResourcePermissions[] = [
  // ── Patient ──────────────────────────────────────────────────────────────
  row("Patient", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: { read: "all", write: true, update: "all", delete: false },
    RECEPTIONIST: { read: "all", write: true, update: "all", delete: false },
    NURSE: { read: "all", write: false, update: "none", delete: false },
    CALL_OPERATOR: { read: "all", write: false, update: "none", delete: false },
  }),

  // ── Appointment ──────────────────────────────────────────────────────────
  row("Appointment", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: { read: "own", write: false, update: "own", delete: false },
    RECEPTIONIST: { read: "all", write: true, update: "all", delete: true },
    NURSE: { read: "today", write: false, update: "none", delete: false },
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
  row("Payment", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: { read: "own", write: false, update: "none", delete: false },
    RECEPTIONIST: { read: "all", write: true, update: "all", delete: false },
    NURSE: NONE,
    CALL_OPERATOR: { read: "all", write: false, update: "none", delete: false },
  }),

  // ── MedicalCase ──────────────────────────────────────────────────────────
  row("MedicalCase", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: { read: "own", write: true, update: "own", delete: false },
    RECEPTIONIST: { read: "all", write: true, update: "all", delete: false },
    NURSE: { read: "all", write: false, update: "none", delete: false },
    CALL_OPERATOR: { read: "all", write: false, update: "none", delete: false },
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
  row("Lead", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: NONE,
    RECEPTIONIST: { read: "all", write: true, update: "all", delete: false },
    NURSE: NONE,
    CALL_OPERATOR: { read: "all", write: true, update: "all", delete: false },
  }),

  // ── Call ─────────────────────────────────────────────────────────────────
  row("Call", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: NONE,
    RECEPTIONIST: { read: "all", write: true, update: "all", delete: false },
    NURSE: NONE,
    CALL_OPERATOR: { read: "all", write: true, update: "all", delete: true },
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
  row("Settings", {
    SUPER_ADMIN: FULL,
    ADMIN: FULL,
    DOCTOR: { read: "all", write: false, update: "none", delete: false },
    RECEPTIONIST: { read: "all", write: false, update: "none", delete: false },
    NURSE: { read: "all", write: false, update: "none", delete: false },
    CALL_OPERATOR: { read: "all", write: false, update: "none", delete: false },
  }),
];

/** Look up a permission row; returns `undefined` if the resource is unknown. */
export function getResourcePermissions(
  resource: ResourceKey,
): ResourcePermissions | undefined {
  return PERMISSION_MATRIX.find((r) => r.resource === resource);
}
