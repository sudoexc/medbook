/**
 * `findServicesOrphanedByDeactivating` — the Phase 11 invariant that an active
 * service always has at least one active doctor behind it.
 *
 * Why this exists: the guard was only wired into DELETE, while the CRM
 * deactivates through `PATCH { isActive: false }`. That left the identical
 * operation unguarded on the path the UI actually uses, so a clinic could take
 * its last cardiologist offline and leave "Консультация кардиолога" bookable
 * with nobody to book. Both routes now call this helper; these tests pin the
 * decision table so a future refactor can't quietly drop one side again.
 *
 * Only `@/lib/prisma` is stubbed — the helper's own set logic runs for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Link = { serviceId: string; doctorId: string; doctorActive: boolean };
type ServiceRow = { id: string; nameRu: string; nameUz: string; isActive: boolean };

const state: { links: Link[]; services: ServiceRow[] } = {
  links: [],
  services: [],
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceOnDoctor: {
      findMany: vi.fn(async ({ where, select }: any) => {
        let rows = state.links;
        if (where?.doctorId && typeof where.doctorId === "string") {
          rows = rows.filter((l) => l.doctorId === where.doctorId);
        }
        if (where?.doctorId?.not) {
          rows = rows.filter((l) => l.doctorId !== where.doctorId.not);
        }
        if (where?.serviceId?.in) {
          rows = rows.filter((l) => where.serviceId.in.includes(l.serviceId));
        }
        if (where?.doctor?.isActive === true) {
          rows = rows.filter((l) => l.doctorActive);
        }
        void select;
        return rows.map((l) => ({ serviceId: l.serviceId }));
      }),
    },
    service: {
      findMany: vi.fn(async ({ where }: any) => {
        let rows = state.services;
        if (where?.id?.in) rows = rows.filter((s) => where.id.in.includes(s.id));
        if (where?.isActive === true) rows = rows.filter((s) => s.isActive);
        return rows.map(({ id, nameRu, nameUz }) => ({ id, nameRu, nameUz }));
      }),
    },
  },
}));

const { findServicesOrphanedByDeactivating } = await import(
  "@/server/doctors/deactivation"
);

const svc = (id: string, isActive = true): ServiceRow => ({
  id,
  nameRu: `Услуга ${id}`,
  nameUz: `Xizmat ${id}`,
  isActive,
});

beforeEach(() => {
  state.links = [];
  state.services = [];
});

describe("findServicesOrphanedByDeactivating", () => {
  it("returns nothing for a doctor with no services at all", async () => {
    state.services = [svc("s1")];
    expect(await findServicesOrphanedByDeactivating("d1")).toEqual([]);
  });

  it("allows deactivation when another ACTIVE doctor still covers the service", async () => {
    state.services = [svc("s1")];
    state.links = [
      { serviceId: "s1", doctorId: "d1", doctorActive: true },
      { serviceId: "s1", doctorId: "d2", doctorActive: true },
    ];
    expect(await findServicesOrphanedByDeactivating("d1")).toEqual([]);
  });

  it("blocks when the only other doctor on the service is already inactive", async () => {
    state.services = [svc("s1")];
    state.links = [
      { serviceId: "s1", doctorId: "d1", doctorActive: true },
      { serviceId: "s1", doctorId: "d2", doctorActive: false },
    ];
    const orphaned = await findServicesOrphanedByDeactivating("d1");
    expect(orphaned.map((s) => s.id)).toEqual(["s1"]);
  });

  it("blocks the last provider and names the service for the UI", async () => {
    state.services = [svc("s1")];
    state.links = [{ serviceId: "s1", doctorId: "d1", doctorActive: true }];
    const orphaned = await findServicesOrphanedByDeactivating("d1");
    expect(orphaned).toEqual([
      { id: "s1", nameRu: "Услуга s1", nameUz: "Xizmat s1" },
    ]);
  });

  it("ignores services that are themselves already retired", async () => {
    // A disabled service losing its last doctor is not a product problem —
    // nobody can book it either way.
    state.services = [svc("s1", false)];
    state.links = [{ serviceId: "s1", doctorId: "d1", doctorActive: true }];
    expect(await findServicesOrphanedByDeactivating("d1")).toEqual([]);
  });

  it("reports only the uncovered subset when a doctor holds several services", async () => {
    state.services = [svc("s1"), svc("s2"), svc("s3")];
    state.links = [
      // s1 stays covered by an active colleague
      { serviceId: "s1", doctorId: "d1", doctorActive: true },
      { serviceId: "s1", doctorId: "d2", doctorActive: true },
      // s2 would be orphaned
      { serviceId: "s2", doctorId: "d1", doctorActive: true },
      // s3 would be orphaned too — its only colleague is inactive
      { serviceId: "s3", doctorId: "d1", doctorActive: true },
      { serviceId: "s3", doctorId: "d3", doctorActive: false },
    ];
    const orphaned = await findServicesOrphanedByDeactivating("d1");
    expect(orphaned.map((s) => s.id).sort()).toEqual(["s2", "s3"]);
  });

  it("is unaffected by the doctor's own duplicate links", async () => {
    state.services = [svc("s1")];
    state.links = [
      { serviceId: "s1", doctorId: "d1", doctorActive: true },
      { serviceId: "s1", doctorId: "d1", doctorActive: true },
    ];
    const orphaned = await findServicesOrphanedByDeactivating("d1");
    expect(orphaned.map((s) => s.id)).toEqual(["s1"]);
  });
});
