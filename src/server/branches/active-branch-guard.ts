/**
 * Is the branch in the `active_branch_id` cookie still a live branch of the
 * caller's clinic? (audit ST-06)
 *
 * The cookie was checked once, when it was set, and then trusted for 30
 * days: every API call added `branchId = <cookie>` to doctors, cabinets,
 * appointments and schedules. After an admin switched that branch off, a
 * receptionist who had picked it saw an empty queue, schedule and doctor
 * list, the switcher was gone (it lists active branches only and hides at
 * one), and only clearing the browser's cookies helped. A forged or stale
 * value pinned queries to nothing in the same way.
 *
 * Now the API handler asks here first and drops a branch that does not
 * exist, belongs to another clinic or is switched off: the request runs
 * clinic-wide, which is also what the switcher's «Все филиалы» label says.
 * Answers are cached briefly per process (the branch list changes rarely;
 * the branch routes forget the cache on every change).
 */
import type { TenantContext } from "@/lib/tenant-context";

const TTL_MS = 30_000;

type Entry = { live: boolean; at: number };

function cache(): Map<string, Entry> {
  const g = globalThis as typeof globalThis & {
    __medbookLiveBranchCache?: Map<string, Entry>;
  };
  if (!g.__medbookLiveBranchCache) g.__medbookLiveBranchCache = new Map();
  return g.__medbookLiveBranchCache;
}

/** `branchId` when it is an active branch of `clinicId`, else null. */
export async function liveBranchIdOrNull(
  clinicId: string,
  branchId: string,
): Promise<string | null> {
  const key = `${clinicId}|${branchId}`;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.live ? branchId : null;
  try {
    // Loaded lazily: the API handler imports this module on every request
    // that carries the cookie, and the Prisma client must not become a
    // static dependency of the handler module.
    const [{ prisma }, { runWithTenant }] = await Promise.all([
      import("@/lib/prisma"),
      import("@/lib/tenant-context"),
    ]);
    const row = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.branch.findFirst({
        where: { id: branchId, clinicId, isActive: true },
        select: { id: true },
      }),
    );
    const live = Boolean(row);
    cache().set(key, { live, at: Date.now() });
    return live ? branchId : null;
  } catch (e) {
    // Not cached. Clinic-wide is the safe reading: same clinic, just
    // unfiltered by branch.
    console.error("[active-branch-guard] lookup failed", e);
    return null;
  }
}

/** The context without a branch scope that is no longer valid. */
export async function withLiveBranch(ctx: TenantContext): Promise<TenantContext> {
  if (ctx.kind !== "TENANT" || !ctx.branchId) return ctx;
  const live = await liveBranchIdOrNull(ctx.clinicId, ctx.branchId);
  if (live) return ctx;
  const { branchId: _dropped, ...rest } = ctx;
  void _dropped;
  return rest;
}

/** Drop cached answers (all, or one branch's) after a branch changed. */
export function forgetLiveBranch(branchId?: string): void {
  const m = cache();
  if (!branchId) {
    m.clear();
    return;
  }
  for (const k of m.keys()) {
    if (k.endsWith(`|${branchId}`)) m.delete(k);
  }
}
