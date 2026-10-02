/**
 * Audit G5-09 — a SUPER_ADMIN clinic visit whose 60 minute lease ran out is
 * closed as "expired" and journaled with its clinic, once, by the worker
 * sweep. Before, nothing ever stamped such a grant: the cookies expire with
 * the lease, so no request arrived carrying it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  grants: [] as Array<{
    id: string;
    superAdminId: string;
    clinicId: string;
    startedAt: Date;
    expiresAt: Date;
    endedAt: Date | null;
    endedReason: string | null;
  }>,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    impersonationGrant: {
      findMany: vi.fn(async ({ where }: { where: { expiresAt: { lte: Date } } }) =>
        h.grants
          .filter((g) => g.endedAt === null && g.expiresAt <= where.expiresAt.lte)
          .map((g) => ({ ...g })),
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { endedAt: Date; endedReason: string };
        }) => {
          const g = h.grants.find((x) => x.id === where.id && x.endedAt === null);
          if (!g) return { count: 0 };
          Object.assign(g, data);
          return { count: 1 };
        },
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.audits.push(data);
        return {};
      }),
    },
  },
}));

import { expireLapsedGrants } from "@/server/platform/impersonation";
import { AUDIT_ACTION } from "@/lib/audit-actions";

const now = new Date("2026-10-02T12:00:00Z");
const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000);

beforeEach(() => {
  h.grants = [
    // Entered 70 minutes ago, lease ended 10 minutes ago, never left.
    { id: "lapsed", superAdminId: "sa1", clinicId: "cA", startedAt: at(70), expiresAt: at(10), endedAt: null, endedReason: null },
    // Still live.
    { id: "live", superAdminId: "sa1", clinicId: "cB", startedAt: at(5), expiresAt: at(-55), endedAt: null, endedReason: null },
    // Left by «Выйти» before the lease ended.
    { id: "exited", superAdminId: "sa1", clinicId: "cC", startedAt: at(200), expiresAt: at(140), endedAt: at(180), endedReason: "user_exit" },
  ];
  h.audits = [];
});

describe("expireLapsedGrants", () => {
  it("closes only the lapsed grant, at its lease end, and journals EXPIRED with its clinic", async () => {
    expect(await expireLapsedGrants(now)).toBe(1);
    const lapsed = h.grants.find((g) => g.id === "lapsed")!;
    expect(lapsed.endedReason).toBe("expired");
    expect(lapsed.endedAt).toEqual(at(10));
    expect(h.grants.find((g) => g.id === "live")!.endedAt).toBeNull();
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_EXPIRED,
        clinicId: "cA",
        actorId: "sa1",
        entityType: "ImpersonationGrant",
        entityId: "lapsed",
        meta: { clinicId: "cA", expiredAtMs: at(10).getTime(), durationMs: 60 * 60_000 },
      }),
    ]);
  });

  it("journals each grant once across ticks", async () => {
    await expireLapsedGrants(now);
    await expireLapsedGrants(now);
    expect(h.audits).toHaveLength(1);
  });
});
