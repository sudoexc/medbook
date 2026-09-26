import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  NO_FLAGS,
  parseCatalogFlags,
  planCatalog,
  writesOf,
  type CatalogSpec,
  type ExistingCatalog,
} from "../../scripts/_catalog-plan";

/**
 * Audit G2-08: seed-neurofax-real deactivated every doctor, service and
 * cabinet, reverted prices and grids, re-enabled dismissed logins, and could
 * fail halfway with the whole clinic switched off. The plan is now additive
 * unless a flag says otherwise, and the script writes it in one transaction.
 */

const spec: CatalogSpec = {
  cabinets: [{ number: "1" }, { number: "5" }],
  services: [
    { code: "KONS", priceBase: 20_000_000 },
    { code: "EEG", priceBase: 15_000_000 },
  ],
  doctors: [
    {
      slug: "busakov",
      email: "busakov@neurofax.uz",
      cabinetNumber: "1",
      services: [{ code: "KONS", priceOverride: 30_000_000 }, { code: "EEG" }],
    },
    {
      slug: "sultanov",
      email: "sultanov@neurofax.uz",
      cabinetNumber: "5",
      services: [{ code: "KONS" }],
    },
  ],
};

/** The live clinic after months of admin work in the UI. */
const customised: ExistingCatalog = {
  cabinets: [
    { id: "cab1", number: "1", isActive: true },
    { id: "cab5", number: "5", isActive: true },
    { id: "cab7", number: "7", isActive: true },
  ],
  services: [
    { id: "s-kons", code: "KONS", isActive: true, priceBase: 25_000_000 }, // new price list
    { id: "s-eeg", code: "EEG", isActive: false, priceBase: 15_000_000 }, // switched off
    { id: "s-mass", code: "MASSAGE", isActive: true, priceBase: 10_000_000 }, // added later
  ],
  doctors: [
    { id: "d-bus", slug: "busakov", isActive: true, cabinetId: "cab1", userId: "u-bus" },
    { id: "d-sul", slug: "sultanov", isActive: false, cabinetId: "cab5", userId: "u-sul" }, // dismissed
    { id: "d-new", slug: "new-doctor", isActive: true, cabinetId: "cab7", userId: "u-new" },
  ],
  users: [
    { id: "u-bus", email: "busakov@neurofax.uz" },
    { id: "u-sul", email: "sultanov@neurofax.uz" },
  ],
};

describe("planCatalog: default run on the live clinic", () => {
  const ops = planCatalog(spec, customised);

  it("changes nothing the admin set in the UI", () => {
    expect(writesOf(ops)).toEqual([]);
  });

  it("leaves a dismissed doctor inactive and says so", () => {
    expect(ops).toContainEqual(
      expect.objectContaining({ kind: "skip", what: "doctor sultanov" }),
    );
    expect(ops.some((o) => o.kind === "doctor.activate")).toBe(false);
  });

  it("never plans a deactivation, a price or a schedule change", () => {
    for (const o of ops) {
      expect(o.kind).not.toMatch(/deactivate|price|schedule|services/);
    }
  });
});

describe("planCatalog: creates only what is missing", () => {
  it("creates a missing cabinet and a missing doctor, cabinet first", () => {
    const ops = planCatalog(spec, {
      cabinets: [{ id: "cab1", number: "1", isActive: true }],
      services: customised.services,
      doctors: [customised.doctors[0]!],
      users: [customised.users[0]!],
    });
    expect(writesOf(ops)).toEqual([
      { kind: "cabinet.create", number: "5" },
      { kind: "doctor.create", slug: "sultanov", userId: null },
    ]);
  });

  it("skips a doctor whose cabinet another doctor holds instead of failing mid-run", () => {
    const ops = planCatalog(spec, {
      cabinets: customised.cabinets,
      services: customised.services,
      doctors: [
        customised.doctors[0]!,
        { id: "d-x", slug: "someone-else", isActive: true, cabinetId: "cab5", userId: null },
      ],
      users: [],
    });
    expect(ops.some((o) => o.kind === "doctor.create")).toBe(false);
    expect(ops).toContainEqual(
      expect.objectContaining({ kind: "skip", what: "doctor sultanov" }),
    );
  });

  it("links an existing login, unless another doctor already uses it", () => {
    const free = planCatalog(spec, {
      cabinets: customised.cabinets.slice(0, 2),
      services: customised.services,
      doctors: [customised.doctors[0]!],
      users: customised.users,
    });
    expect(writesOf(free)).toContainEqual({ kind: "doctor.create", slug: "sultanov", userId: "u-sul" });

    const taken = planCatalog(spec, {
      cabinets: customised.cabinets.slice(0, 2),
      services: customised.services,
      doctors: [{ ...customised.doctors[0]!, userId: "u-sul" }],
      users: customised.users,
    });
    expect(taken.some((o) => o.kind === "doctor.create")).toBe(false);
  });
});

describe("planCatalog: flags", () => {
  it("--reset-prices rewrites changed prices only", () => {
    const ops = planCatalog(spec, customised, { ...NO_FLAGS, resetPrices: true });
    expect(writesOf(ops)).toEqual([
      { kind: "service.price", id: "s-kons", code: "KONS", from: 25_000_000, to: 20_000_000 },
      { kind: "doctor.prices", id: "d-bus", slug: "busakov" },
      { kind: "doctor.prices", id: "d-sul", slug: "sultanov" },
    ]);
  });

  it("--deactivate-others switches off only rows outside the line-up", () => {
    const ops = writesOf(planCatalog(spec, customised, { ...NO_FLAGS, deactivateOthers: true }));
    expect(ops).toEqual([
      { kind: "cabinet.deactivate", id: "cab7", number: "7" },
      { kind: "service.deactivate", id: "s-mass", code: "MASSAGE" },
      { kind: "doctor.deactivate", id: "d-new", slug: "new-doctor" },
    ]);
  });

  it("--reactivate turns the doctor and service back on, never a login", () => {
    const ops = writesOf(planCatalog(spec, customised, { ...NO_FLAGS, reactivate: true }));
    expect(ops).toEqual([
      { kind: "service.activate", id: "s-eeg", code: "EEG" },
      { kind: "doctor.activate", id: "d-sul", slug: "sultanov" },
    ]);
  });

  it("parses the CLI flags", () => {
    expect(parseCatalogFlags(["--reset-schedules", "--reactivate"])).toEqual({
      ...NO_FLAGS,
      resetSchedules: true,
      reactivate: true,
    });
  });
});

describe("seed-neurofax-real itself", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../scripts/seed-neurofax-real.ts"),
    "utf8",
  );

  it("is a dry run unless APPLY=1 and writes in one transaction", () => {
    expect(src).toMatch(/process\.env\.APPLY === "1"/);
    expect(src).toMatch(/prisma\.\$transaction\(/);
  });

  it("has no clinic-wide deactivation and never sets a login active", () => {
    expect(src).not.toMatch(/updateMany\(\{\s*where: \{ clinicId/);
    // A code line setting User.active (the header comment quotes the old one).
    expect(src).not.toMatch(/^\s+active: true,?$/m);
  });
});
