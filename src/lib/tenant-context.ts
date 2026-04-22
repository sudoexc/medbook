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

export type TenantContext =
  | { kind: "TENANT"; clinicId: string; userId: string; role: Role }
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

/** True iff the current context is a regular tenant user. */
export function isTenantContext(): boolean {
  return getTenant()?.kind === "TENANT";
}
