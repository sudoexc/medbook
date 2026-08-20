/**
 * Tenant-scoped Prisma client.
 *
 * `docs/TZ.md` §5.5: every operational model carries `clinicId`, and the
 * client here auto-injects it into `where` / `data` from the AsyncLocalStorage
 * context (`src/lib/tenant-context.ts`).
 *
 * Behaviour per context kind:
 *   TENANT       → inject clinicId into where/data for non-allowlisted models.
 *   SUPER_ADMIN  → never inject; handlers may filter by clinicId manually.
 *   SYSTEM       → never inject; used by cron, onboarding seeders, workers.
 *   UNSCOPED     → never inject; explicit `runUnscoped(reason, fn)` bypass
 *                  for pre-auth / capability-URL paths.
 *   (no ctx)     → FAIL CLOSED. Querying a tenant-scoped model without any
 *                  context throws `MissingTenantContextError` instead of
 *                  silently running cross-tenant. Models without a clinicId
 *                  column (`MODELS_WITHOUT_TENANT`) still pass through, so
 *                  auth-time User/Session lookups keep working.
 *
 * Composite unique lookups (`where: { clinicId_slug: {...} }`) already embed
 * clinicId — the extension detects these via `COMPOSITE_TENANT_UNIQUES` and
 * avoids dual injection.
 *
 * Callers with a legitimate need to bypass scoping inside a TENANT context
 * (e.g. reading global FX rates from a tenant session) can pass
 * `{ skipTenantScope: true }` alongside normal Prisma args — the extension
 * strips that flag before forwarding. This is allowed only for models listed
 * in `MODELS_TENANT_BYPASSABLE`.
 *
 * Phase 9a — Branch scoping
 *   When the TENANT context carries `branchId`, the extension layers a second
 *   filter (`branchId = ctx.branchId`) on top of the clinicId injection, but
 *   only for branch-scoped models (`MODELS_BRANCH_SCOPED`). For every other
 *   model, including clinic-wide ones like Patient and Payment, behaviour is
 *   exactly as before. When `branchId` is absent from the context, the
 *   extension behaves identically to pre-Phase-9a code — so existing routes
 *   keep working without modification.
 */

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { getTenant } from "./tenant-context";
import {
  COMPOSITE_TENANT_UNIQUES,
  CREATE_OPERATIONS,
  MODELS_BRANCH_SCOPED,
  MODELS_TENANT_BYPASSABLE,
  MODELS_WITHOUT_TENANT,
  MUTATE_BY_WHERE_OPERATIONS,
  READ_OPERATIONS,
} from "./tenant-allowlist";

type UnknownRecord = Record<string, unknown>;

/**
 * Thrown when a tenant-scoped model is queried with NO tenant context bound.
 *
 * Before the security-audit fix this case silently passed through unscoped —
 * any code path that forgot `runWithTenant` would read/write EVERY clinic's
 * data without anyone noticing (fail-open). Now isolation fails closed: the
 * query is rejected before it reaches Postgres, and the error text tells the
 * developer exactly which query tripped it and what the legitimate escape
 * hatches are.
 */
export class MissingTenantContextError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Tenant isolation violation: "${model}.${operation}" was called without a ` +
        `tenant context, and ${model} is a tenant-scoped model. Refusing to run ` +
        `an unscoped cross-tenant query. Fix: run this code inside ` +
        `runWithTenant(ctx, fn) — createApiHandler / createMiniAppHandler / ` +
        `createPublicClinicHandler already do this for their routes; background ` +
        `jobs should use runWithTenant({ kind: "SYSTEM" }, fn). If this path is ` +
        `LEGITIMATELY cross-tenant or pre-auth (e.g. a capability-URL lookup), ` +
        `make that explicit with runUnscoped(reason, fn) from "@/lib/tenant-context".`
    );
    this.name = "MissingTenantContextError";
  }
}

function buildBaseClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? "",
  });
  return new PrismaClient({ adapter, log: ["warn", "error"] });
}

/**
 * Returns `true` if the given `where` object already pins `clinicId`
 * either directly or via one of the composite unique inputs.
 */
function whereAlreadyPinsClinic(
  model: string | undefined,
  where: UnknownRecord | undefined
): boolean {
  if (!where) return false;
  if (typeof where.clinicId !== "undefined") return true;
  if (!model) return false;
  for (const key of Object.keys(where)) {
    if (COMPOSITE_TENANT_UNIQUES.has(`${model}.${key}`)) return true;
  }
  return false;
}

/**
 * Strip and return the `skipTenantScope` flag (if present) from a mutable
 * args object. The flag is not part of Prisma's public types so the client
 * needs to drop it before forwarding to the underlying query.
 */
function extractSkipFlag(args: UnknownRecord | undefined): boolean {
  if (!args) return false;
  const raw = args.skipTenantScope;
  if (typeof raw === "undefined") return false;
  delete args.skipTenantScope;
  return raw === true;
}

/**
 * Inject clinicId (and optionally branchId) into a `where` clause. Returns
 * a shallow copy with the keys merged — never mutates the original.
 *
 * `branchId` is only injected when the caller passes a non-null value
 * (i.e. the active TenantContext has `branchId` set AND the target model
 * is in `MODELS_BRANCH_SCOPED`).
 */
function injectWhere(
  existing: UnknownRecord | undefined,
  clinicId: string,
  branchId: string | null
): UnknownRecord {
  const next: UnknownRecord = { ...(existing ?? {}), clinicId };
  if (branchId !== null && typeof next.branchId === "undefined") {
    next.branchId = branchId;
  }
  return next;
}

/**
 * Inject clinicId (and optionally branchId) into `data`. Supports both
 * single-object and array forms (`createMany({ data: [...] })`).
 *
 * `branchId` is preserved when the caller already specified one — we never
 * overwrite an explicit value.
 */
function injectData(
  existing: unknown,
  clinicId: string,
  branchId: string | null
): unknown {
  if (Array.isArray(existing)) {
    return existing.map((row) => {
      if (!row || typeof row !== "object") return row;
      const rec = row as UnknownRecord;
      const patched: UnknownRecord = { ...rec };
      if (!("clinicId" in patched)) patched.clinicId = clinicId;
      if (branchId !== null && !("branchId" in patched)) {
        patched.branchId = branchId;
      }
      return patched;
    });
  }
  if (existing && typeof existing === "object") {
    const rec = existing as UnknownRecord;
    const patched: UnknownRecord = { ...rec };
    if (!("clinicId" in patched)) patched.clinicId = clinicId;
    if (branchId !== null && !("branchId" in patched)) {
      patched.branchId = branchId;
    }
    return patched;
  }
  return existing;
}

const globalForPrisma = globalThis as unknown as {
  prismaBase?: PrismaClient;
};

const prismaBase = globalForPrisma.prismaBase ?? buildBaseClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = prismaBase;
}

/**
 * Extended client. We keep `prismaBase` for raw internal uses (there are none
 * expected in app code; `prisma` is always preferred).
 */
export const prisma = prismaBase.$extends({
  name: "tenantScope",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = getTenant();
        const mutableArgs = (args as UnknownRecord | undefined) ?? {};
        const skipFlag = extractSkipFlag(mutableArgs);

        // No context → FAIL CLOSED for tenant-scoped models. A missing
        // `runWithTenant` used to silently run the query unscoped, exposing
        // every clinic's rows; now it throws so the gap is caught in dev/CI
        // instead of leaking data in prod. Models without a clinicId column
        // (User, Session, Clinic, global catalogs…) still pass through —
        // login flows resolve users before any tenant is known.
        if (!ctx) {
          if (model && !MODELS_WITHOUT_TENANT.has(model)) {
            throw new MissingTenantContextError(model, operation);
          }
          return query(mutableArgs as typeof args);
        }

        // SUPER_ADMIN, SYSTEM and UNSCOPED never get auto-scoped. UNSCOPED is
        // the explicit `runUnscoped(reason, fn)` escape hatch — same runtime
        // behaviour as SYSTEM, but the mandatory reason marks the bypass as a
        // conscious decision rather than a forgotten wrapper.
        if (
          ctx.kind === "SUPER_ADMIN" ||
          ctx.kind === "SYSTEM" ||
          ctx.kind === "UNSCOPED"
        ) {
          return query(mutableArgs as typeof args);
        }

        // Model without a tenant column → nothing to inject.
        if (model && MODELS_WITHOUT_TENANT.has(model)) {
          return query(mutableArgs as typeof args);
        }

        // Explicit opt-out for models that support it (FX sync, providers).
        if (
          skipFlag &&
          model &&
          MODELS_TENANT_BYPASSABLE.has(model)
        ) {
          return query(mutableArgs as typeof args);
        }

        const clinicId = ctx.clinicId;

        // Branch scoping (Phase 9a): only when the context carries branchId
        // AND the target model is branch-scoped. For every other call this
        // value stays null, and behaviour is byte-identical to pre-Phase-9a.
        const branchId =
          ctx.branchId && model && MODELS_BRANCH_SCOPED.has(model)
            ? ctx.branchId
            : null;

        // READ + filter-mutate: inject into where unless already present.
        if (
          READ_OPERATIONS.has(operation) ||
          MUTATE_BY_WHERE_OPERATIONS.has(operation)
        ) {
          const where = mutableArgs.where as UnknownRecord | undefined;
          if (!whereAlreadyPinsClinic(model, where)) {
            mutableArgs.where = injectWhere(where, clinicId, branchId);
          } else if (branchId !== null) {
            // Composite-clinic `where` is used (e.g. clinicId_slug). We must
            // not duplicate clinicId, but we still want to additionally pin
            // branchId when the model is branch-scoped.
            const w = (where ?? {}) as UnknownRecord;
            if (typeof w.branchId === "undefined") {
              mutableArgs.where = { ...w, branchId };
            }
          }

          // `upsert` also carries `create` and `update` payloads that must
          // be scoped in case Prisma inserts a new row.
          if (operation === "upsert") {
            mutableArgs.create = injectData(
              mutableArgs.create,
              clinicId,
              branchId
            );
            // `update` stays untouched — it's a partial patch; we just
            // filtered via `where` above.
          }
          return query(mutableArgs as typeof args);
        }

        // CREATE: inject into data.
        if (CREATE_OPERATIONS.has(operation)) {
          mutableArgs.data = injectData(mutableArgs.data, clinicId, branchId);
          return query(mutableArgs as typeof args);
        }

        // Any other operation ($runCommandRaw, $queryRaw, etc.) — pass through.
        return query(mutableArgs as typeof args);
      },
    },
  },
});

export type TenantScopedPrisma = typeof prisma;
