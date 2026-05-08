/**
 * Per-request tenant context, stored in AsyncLocalStorage.
 *
 * See `docs/TZ.md` §5.5. Every HTTP request that reads or mutates
 * tenant-scoped data MUST run inside `runWithTenant(ctx, fn)`.
 *
 *   TENANT       — a regular clinic user; their `clinicId` auto-scopes Prisma.
 *   SUPER_ADMIN  — platform operator; Prisma is NOT auto-scoped. Handlers for
 *                  the `/admin` area must explicitly select clinics.
 *   SYSTEM       — cron / workers / onboarding seeding; bypasses tenant scope.
 *
 * Phase 9a — TENANT contexts MAY additionally carry a `branchId`. When
 * present, the Prisma extension layers a second filter on top of `clinicId`
 * for the branch-scoped models (Doctor, Cabinet, Appointment, DoctorSchedule,
 * DoctorTimeOff). Absence of `branchId` keeps the historical clinic-wide
 * behavior — no breaking changes for routes that have not yet been updated.
 *
 * The context is read by the Prisma `$extends` query hook in `src/lib/prisma.ts`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR";

/**
 * Phase 19 Wave 4 — when a SUPER_ADMIN enters a clinic via the switcher we
 * stamp the resolved grant onto the TENANT context. `mode === "VIEW_ONLY"`
 * makes `createApiHandler` reject every mutating method with 403
 * `ViewAsReadOnly`. `WRITE` mode behaves like a normal TENANT.
 *
 * `null` (or undefined) means "no impersonation in flight" — i.e. either a
 * regular tenant user or a SUPER_ADMIN with a fresh, valid WRITE grant where
 * we deliberately don't carry the metadata downstream.
 */
export type ImpersonationStamp = {
  grantId: string;
  mode: "WRITE" | "VIEW_ONLY";
  superAdminId: string;
};

export type TenantContext =
  | {
      kind: "TENANT";
      clinicId: string;
      userId: string;
      role: Role;
      /**
       * Optional branch scope (Phase 9a). When set, the Prisma extension
       * also filters branch-scoped models by `branchId`. When absent, queries
       * stay clinic-wide as before.
       */
      branchId?: string;
      /**
       * Phase 19 Wave 4 — set only when the TENANT context was synthesised
       * from a SUPER_ADMIN's clinic-override. Downstream API guards read
       * `impersonation?.mode === "VIEW_ONLY"` to reject writes.
       */
      impersonation?: ImpersonationStamp | null;
    }
  | { kind: "SUPER_ADMIN"; userId: string }
  | { kind: "SYSTEM" };

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` with the given `TenantContext` bound to AsyncLocalStorage.
 * All async calls chained from `fn` see the same context.
 */
export function runWithTenant<T>(
  ctx: TenantContext,
  fn: () => T | Promise<T>
): Promise<T> {
  return Promise.resolve(storage.run(ctx, fn));
}

/** Read the current TenantContext, or `undefined` if not inside `runWithTenant`. */
export function getTenant(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Assert a context is present. Throws an Error (request handlers should
 * translate into a 403 response). Intentionally not a HttpError so the
 * module stays Next-agnostic and easy to test.
 */
export function requireTenant(): TenantContext {
  const ctx = getTenant();
  if (!ctx) {
    const err = new Error("TenantContextMissing: no AsyncLocalStorage store");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
  return ctx;
}

/**
 * Convenience: return the `clinicId` for TENANT contexts, else `null`.
 * SUPER_ADMIN and SYSTEM return `null` — callers that require an explicit
 * clinic must pick one from URL / headers.
 */
export function getClinicId(): string | null {
  const ctx = getTenant();
  if (!ctx) return null;
  if (ctx.kind === "TENANT") return ctx.clinicId;
  return null;
}

/**
 * Phase 9a: return the optional `branchId` for TENANT contexts.
 * Returns `null` when no context, when the context is not TENANT, or when
 * the TENANT context has no branch scope (i.e. clinic-wide mode).
 */
export function getBranchId(): string | null {
  const ctx = getTenant();
  if (!ctx) return null;
  if (ctx.kind !== "TENANT") return null;
  return ctx.branchId ?? null;
}

/** True iff the current context is a regular tenant user. */
export function isTenantContext(): boolean {
  return getTenant()?.kind === "TENANT";
}
