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
 *   (no ctx)     → never inject; callers that need isolation must runWithTenant.
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
 */

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { getTenant } from "./tenant-context";
import {
  COMPOSITE_TENANT_UNIQUES,
  CREATE_OPERATIONS,
  MODELS_TENANT_BYPASSABLE,
  MODELS_WITHOUT_TENANT,
  MUTATE_BY_WHERE_OPERATIONS,
  READ_OPERATIONS,
} from "./tenant-allowlist";

type UnknownRecord = Record<string, unknown>;

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
 * Inject clinicId into a `where` clause. Mutates a shallow copy; returns
 * the new clause so the caller can assign it back.
 */
function injectWhere(
  existing: UnknownRecord | undefined,
  clinicId: string
): UnknownRecord {
  return { ...(existing ?? {}), clinicId };
}

/**
 * Inject clinicId into `data`. Supports both single-object and array forms
 * (`createMany({ data: [...] })`).
 */
function injectData(
  existing: unknown,
  clinicId: string
): unknown {
  if (Array.isArray(existing)) {
    return existing.map((row) =>
      row && typeof row === "object" && !("clinicId" in row)
        ? { ...row, clinicId }
        : row
    );
  }
  if (existing && typeof existing === "object") {
    const rec = existing as UnknownRecord;
    if ("clinicId" in rec) return rec;
    return { ...rec, clinicId };
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

        // No context → pass through. Callers that need isolation must
        // wrap their invocation with runWithTenant.
        if (!ctx) {
          return query(mutableArgs as typeof args);
        }

        // SUPER_ADMIN and SYSTEM never get auto-scoped.
        if (ctx.kind === "SUPER_ADMIN" || ctx.kind === "SYSTEM") {
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

        // READ + filter-mutate: inject into where unless already present.
        if (
          READ_OPERATIONS.has(operation) ||
          MUTATE_BY_WHERE_OPERATIONS.has(operation)
        ) {
          const where = mutableArgs.where as UnknownRecord | undefined;
          if (!whereAlreadyPinsClinic(model, where)) {
            mutableArgs.where = injectWhere(where, clinicId);
          }

          // `upsert` also carries `create` and `update` payloads that must
          // be scoped in case Prisma inserts a new row.
          if (operation === "upsert") {
            mutableArgs.create = injectData(mutableArgs.create, clinicId);
            // `update` stays untouched — it's a partial patch; we just
            // filtered via `where` above.
          }
          return query(mutableArgs as typeof args);
        }

        // CREATE: inject into data.
        if (CREATE_OPERATIONS.has(operation)) {
          mutableArgs.data = injectData(mutableArgs.data, clinicId);
          return query(mutableArgs as typeof args);
        }

        // Any other operation ($runCommandRaw, $queryRaw, etc.) — pass through.
        return query(mutableArgs as typeof args);
      },
    },
  },
});

export type TenantScopedPrisma = typeof prisma;
