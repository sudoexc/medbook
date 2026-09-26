/**
 * Pure planning for `seed-neurofax-real.ts` (audit G2-08), kept apart so unit
 * tests can pin it without a database.
 *
 * The old script ran, without a transaction: deactivate EVERY cabinet,
 * service and doctor of the clinic, then upsert the hard-coded line-up with
 * the 18.05 prices and weekly grids, and `active: true` on every doctor's
 * login. On the live clinic that reverted prices and schedules the admin had
 * changed, hid doctors and services added since, let a dismissed doctor sign
 * in again, and a P2002 on the unique Doctor.cabinetId halfway through left
 * the clinic with no active doctor at all.
 *
 * Now the default plan is strictly additive: it only CREATES what is missing
 * (a cabinet, a service, a doctor with its links and grid). Existing rows keep
 * their prices, schedules, links, names and isActive; a User's `active` is
 * never touched. Everything else needs an explicit flag, and a create that
 * would hit a unique index is planned as a skip instead of failing mid-run.
 */

export type CatalogSpec = {
  cabinets: Array<{ number: string }>;
  services: Array<{ code: string; priceBase: number }>;
  doctors: Array<{
    slug: string;
    email: string;
    cabinetNumber: string;
    services: Array<{ code: string; priceOverride?: number }>;
  }>;
};

export type ExistingCatalog = {
  cabinets: Array<{ id: string; number: string; isActive: boolean }>;
  services: Array<{ id: string; code: string; isActive: boolean; priceBase: number }>;
  doctors: Array<{
    id: string;
    slug: string;
    isActive: boolean;
    cabinetId: string;
    userId: string | null;
  }>;
  /** Users whose email is one of the spec's doctor emails. */
  users: Array<{ id: string; email: string }>;
};

export type CatalogFlags = {
  /** Turn canonical cabinets/services/doctors that exist but are inactive back on. */
  reactivate: boolean;
  /** Turn off cabinets/services/doctors that are not in the spec. */
  deactivateOthers: boolean;
  /** Service.priceBase and the doctors' priceOverride back to the spec. */
  resetPrices: boolean;
  /** Replace existing canonical doctors' weekly grids with the spec. */
  resetSchedules: boolean;
  /** Replace existing canonical doctors' service links with the spec. */
  resetDoctorServices: boolean;
};

export const NO_FLAGS: CatalogFlags = {
  reactivate: false,
  deactivateOthers: false,
  resetPrices: false,
  resetSchedules: false,
  resetDoctorServices: false,
};

/** CLI flag for each option, parsed by `parseCatalogFlags`. */
export const CATALOG_FLAG_NAMES: Record<keyof CatalogFlags, string> = {
  reactivate: "--reactivate",
  deactivateOthers: "--deactivate-others",
  resetPrices: "--reset-prices",
  resetSchedules: "--reset-schedules",
  resetDoctorServices: "--reset-doctor-services",
};

export function parseCatalogFlags(argv: string[]): CatalogFlags {
  const out = { ...NO_FLAGS };
  for (const key of Object.keys(CATALOG_FLAG_NAMES) as Array<keyof CatalogFlags>) {
    out[key] = argv.includes(CATALOG_FLAG_NAMES[key]);
  }
  return out;
}

export type CatalogOp =
  | { kind: "cabinet.create"; number: string }
  | { kind: "cabinet.activate"; id: string; number: string }
  | { kind: "cabinet.deactivate"; id: string; number: string }
  | { kind: "service.create"; code: string }
  | { kind: "service.activate"; id: string; code: string }
  | { kind: "service.deactivate"; id: string; code: string }
  | { kind: "service.price"; id: string; code: string; from: number; to: number }
  /** New doctor with its links and grid; `userId` links an existing login, null creates one. */
  | { kind: "doctor.create"; slug: string; userId: string | null }
  | { kind: "doctor.activate"; id: string; slug: string }
  | { kind: "doctor.deactivate"; id: string; slug: string }
  | { kind: "doctor.prices"; id: string; slug: string }
  | { kind: "doctor.schedule"; id: string; slug: string }
  | { kind: "doctor.services"; id: string; slug: string }
  | { kind: "skip"; what: string; reason: string };

export function planCatalog(
  spec: CatalogSpec,
  existing: ExistingCatalog,
  flags: CatalogFlags = NO_FLAGS,
): CatalogOp[] {
  const ops: CatalogOp[] = [];

  // Cabinets
  const cabByNumber = new Map(existing.cabinets.map((c) => [c.number, c]));
  const canonicalCabs = new Set(spec.cabinets.map((c) => c.number));
  for (const c of spec.cabinets) {
    const row = cabByNumber.get(c.number);
    if (!row) ops.push({ kind: "cabinet.create", number: c.number });
    else if (!row.isActive && flags.reactivate) {
      ops.push({ kind: "cabinet.activate", id: row.id, number: c.number });
    }
  }
  if (flags.deactivateOthers) {
    for (const c of existing.cabinets) {
      if (c.isActive && !canonicalCabs.has(c.number)) {
        ops.push({ kind: "cabinet.deactivate", id: c.id, number: c.number });
      }
    }
  }

  // Services
  const svcByCode = new Map(existing.services.map((s) => [s.code, s]));
  const canonicalSvcs = new Set(spec.services.map((s) => s.code));
  for (const s of spec.services) {
    const row = svcByCode.get(s.code);
    if (!row) {
      ops.push({ kind: "service.create", code: s.code });
      continue;
    }
    if (!row.isActive && flags.reactivate) {
      ops.push({ kind: "service.activate", id: row.id, code: s.code });
    }
    if (flags.resetPrices && row.priceBase !== s.priceBase) {
      ops.push({ kind: "service.price", id: row.id, code: s.code, from: row.priceBase, to: s.priceBase });
    }
  }
  if (flags.deactivateOthers) {
    for (const s of existing.services) {
      if (s.isActive && !canonicalSvcs.has(s.code)) {
        ops.push({ kind: "service.deactivate", id: s.id, code: s.code });
      }
    }
  }

  // Doctors
  const docBySlug = new Map(existing.doctors.map((d) => [d.slug, d]));
  const canonicalDocs = new Set(spec.doctors.map((d) => d.slug));
  const cabNumberById = new Map(existing.cabinets.map((c) => [c.id, c.number]));
  // Doctor.cabinetId and Doctor.userId are unique: know who holds what.
  const cabinetHolder = new Map<string, string>(); // cabinet number → doctor slug
  for (const d of existing.doctors) {
    const n = cabNumberById.get(d.cabinetId);
    if (n) cabinetHolder.set(n, d.slug);
  }
  const userHolder = new Map<string, string>(); // user id → doctor slug
  for (const d of existing.doctors) if (d.userId) userHolder.set(d.userId, d.slug);
  const userByEmail = new Map(existing.users.map((u) => [u.email.toLowerCase(), u]));

  for (const d of spec.doctors) {
    const row = docBySlug.get(d.slug);
    if (!row) {
      const holder = cabinetHolder.get(d.cabinetNumber);
      if (holder) {
        ops.push({
          kind: "skip",
          what: `doctor ${d.slug}`,
          reason: `cabinet ${d.cabinetNumber} already belongs to ${holder}`,
        });
        continue;
      }
      const user = userByEmail.get(d.email.toLowerCase()) ?? null;
      if (user && userHolder.has(user.id)) {
        ops.push({
          kind: "skip",
          what: `doctor ${d.slug}`,
          reason: `login ${d.email} already belongs to ${userHolder.get(user.id)}`,
        });
        continue;
      }
      ops.push({ kind: "doctor.create", slug: d.slug, userId: user?.id ?? null });
      cabinetHolder.set(d.cabinetNumber, d.slug);
      if (user) userHolder.set(user.id, d.slug);
      continue;
    }
    if (!row.isActive) {
      if (flags.reactivate) ops.push({ kind: "doctor.activate", id: row.id, slug: d.slug });
      else {
        ops.push({
          kind: "skip",
          what: `doctor ${d.slug}`,
          reason: `inactive (dismissed?), left as is; ${CATALOG_FLAG_NAMES.reactivate} turns it back on`,
        });
      }
    }
    if (flags.resetDoctorServices) ops.push({ kind: "doctor.services", id: row.id, slug: d.slug });
    else if (flags.resetPrices) ops.push({ kind: "doctor.prices", id: row.id, slug: d.slug });
    if (flags.resetSchedules) ops.push({ kind: "doctor.schedule", id: row.id, slug: d.slug });
  }
  if (flags.deactivateOthers) {
    for (const d of existing.doctors) {
      if (d.isActive && !canonicalDocs.has(d.slug)) {
        ops.push({ kind: "doctor.deactivate", id: d.id, slug: d.slug });
      }
    }
  }
  return ops;
}

/** Ops that change data, i.e. everything except skips. */
export function writesOf(ops: CatalogOp[]): CatalogOp[] {
  return ops.filter((o) => o.kind !== "skip");
}
