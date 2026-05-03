/**
 * Allowlist / policy tables used by the Prisma tenant-scope extension.
 *
 * See `docs/TZ.md` §5.5 — multi-tenancy rules.
 *
 * The Prisma query extension in `src/lib/prisma.ts` consults these sets
 * to decide whether (and how) to inject `clinicId` into query args.
 */

/**
 * Models that DO NOT carry a `clinicId` column (or whose `clinicId` is
 * intentionally optional + cross-tenant). The extension never touches
 * `where`/`data` for these models.
 */
export const MODELS_WITHOUT_TENANT: ReadonlySet<string> = new Set([
  "Clinic",
  "User",
  "Account",
  "Session",
  "VerificationToken",
  "AuditLog",
  // Phase 11 join model: tenancy is implied by both `doctor` and `service`,
  // and the table itself has no `clinicId` column. Without this entry the
  // extension would inject `clinicId` and Prisma rejects the call.
  "ServiceOnDoctor",
]);

/**
 * Models that have a tenant column but may be accessed from SYSTEM /
 * cross-tenant contexts (cron, onboarding, FX sync). The caller opts
 * out of auto-scoping for a single query by passing
 * `{ skipTenantScope: true }` as an extra arg (merged via the
 * extension) OR by running inside `runWithTenant({ kind: 'SYSTEM' }, ...)`.
 */
export const MODELS_TENANT_BYPASSABLE: ReadonlySet<string> = new Set([
  "ExchangeRate",
  "ProviderConnection",
]);

/**
 * Composite unique keys whose first component is already `clinicId`.
 * When a caller uses one of these via `where: { clinicId_xxx: {...} }`,
 * the extension MUST NOT also append a top-level `clinicId` — that would
 * duplicate the column in the generated SQL and Prisma refuses such args.
 *
 * Keep in sync with `prisma/schema.prisma` `@@unique([clinicId, ...])`.
 */
export const COMPOSITE_TENANT_UNIQUES: ReadonlySet<string> = new Set([
  "Patient.clinicId_phoneNormalized",
  "Doctor.clinicId_slug",
  "Service.clinicId_code",
  "Cabinet.clinicId_number",
  "NotificationTemplate.clinicId_key",
  "ExchangeRate.clinicId_date",
  "ProviderConnection.clinicId_kind_label",
  "Conversation.clinicId_externalId",
  "Message.clinicId_externalId",
  "Call.clinicId_sipCallId",
  "Branch.clinicId_slug",
]);

/**
 * Branch-scoped models (Phase 9a). When the active TenantContext carries an
 * explicit `branchId`, the Prisma extension layers a second filter
 * (`branchId = …`) on top of the existing `clinicId` injection — but only
 * for these models. All other clinic-scoped models (Patient, Service,
 * Payment, Document, Communication, Conversation, Message, Notification…)
 * stay clinic-wide regardless of branch.
 *
 * The `Branch` model itself is intentionally NOT in this set: the canonical
 * way to look up a branch is by clinic + slug or clinic + isDefault.
 *
 * Keep in sync with the `branchId String?` columns in `prisma/schema.prisma`.
 */
export const MODELS_BRANCH_SCOPED: ReadonlySet<string> = new Set([
  "Doctor",
  "Cabinet",
  "Appointment",
  "DoctorSchedule",
  "DoctorTimeOff",
]);

/** Operations that read data — we inject `clinicId` into `where`. */
export const READ_OPERATIONS = new Set<string>([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

/** Operations that mutate by filter — we inject `clinicId` into `where`. */
export const MUTATE_BY_WHERE_OPERATIONS = new Set<string>([
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

/** Operations that create records — we inject `clinicId` into `data`. */
export const CREATE_OPERATIONS = new Set<string>([
  "create",
  "createMany",
  "createManyAndReturn",
]);
