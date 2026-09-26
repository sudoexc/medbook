/**
 * Audit LD-10, review of the fix: rows stored in the old «+334125567» shape.
 *
 * normalizePhone now turns «33 412 55 67» into «+998334125567». Before, it
 * made «+334125567» of it, and every card, relative's contact phone and lead
 * written then keeps that shape until scripts/fix-ld10-local-phones.ts runs
 * (and a card whose corrected number clashes keeps it until reception
 * sorts the pair out). The walk-in and the CRM «Новый пациент» look a number up through
 * phoneSearchVariants(normalizePhone(typed)); without the old shape among
 * the variants the returning patient was missed and a second verified card
 * was created without the «это тот же пациент?» question. Pinned here:
 *   - the variants of a normalized non-9x number include the old shape;
 *   - decidePhoneOwner finds the old-shape owner, a relative on an
 *     old-shape contact phone, and an old-shape Mini App claim;
 *   - the script also rewrites a relative's contact phone, idempotently,
 *     and writes nothing on a dry run.
 */
import { describe, expect, it, vi } from "vitest";

import { normalizePhone, phoneSearchVariants } from "@/lib/phone";

// phone-identity imports the app's prisma client for its types only; the
// tests pass their own in-memory db.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

type Row = {
  id: string;
  clinicId: string;
  patientNumber: number;
  fullName: string;
  birthDate: Date | null;
  phone: string;
  phoneNormalized: string;
  phoneVerifiedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
};

type StrFilter = string | { in?: string[]; startsWith?: string };

function strMatches(value: string, f: StrFilter | undefined): boolean {
  if (f === undefined) return true;
  if (typeof f === "string") return value === f;
  if (f.in && !f.in.includes(value)) return false;
  if (f.startsWith !== undefined && !value.startsWith(f.startsWith)) return false;
  return true;
}

type Where = {
  id?: string;
  clinicId?: string;
  phone?: StrFilter;
  phoneNormalized?: StrFilter;
  phoneVerifiedAt?: null | { not: null };
  deletedAt?: null;
};

function matches(r: Row, w: Where): boolean {
  if (w.id !== undefined && r.id !== w.id) return false;
  if (w.clinicId !== undefined && r.clinicId !== w.clinicId) return false;
  if (!strMatches(r.phone, w.phone)) return false;
  if (!strMatches(r.phoneNormalized, w.phoneNormalized)) return false;
  if (w.phoneVerifiedAt === null && r.phoneVerifiedAt !== null) return false;
  if (w.phoneVerifiedAt && r.phoneVerifiedAt === null) return false;
  if (w.deletedAt === null && r.deletedAt !== null) return false;
  return true;
}

function row(overrides: Partial<Row> & Pick<Row, "id" | "phone" | "phoneNormalized">): Row {
  return {
    clinicId: "c1",
    patientNumber: 1,
    fullName: "Пациент",
    birthDate: null,
    phoneVerifiedAt: new Date("2026-05-01T00:00:00Z"),
    deletedAt: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

/** Just enough of Prisma for phone-identity and the LD-10 script. */
function fakeDb(patients: Row[], leads: Array<{ id: string; phone: string }> = []) {
  const byAge = (a: Row, b: Row) => a.createdAt.getTime() - b.createdAt.getTime();
  const pick = (r: Row) => ({ ...r });
  return {
    patients,
    leads,
    patient: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => {
        const hit = patients.filter((r) => matches(r, where)).sort(byAge)[0];
        return hit ? pick(hit) : null;
      }),
      findMany: vi.fn(async ({ where }: { where: Where }) =>
        patients.filter((r) => matches(r, where)).sort(byAge).map(pick),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const hits = patients.filter((r) => matches(r, where));
        for (const r of hits) Object.assign(r, data);
        return { count: hits.length };
      }),
    },
    lead: {
      findMany: vi.fn(async ({ where }: { where: { phone: StrFilter } }) =>
        leads.filter((l) => strMatches(l.phone, where.phone)).map((l) => ({ ...l })),
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; phone: string }; data: { phone: string } }) => {
          const hits = leads.filter((l) => l.id === where.id && l.phone === where.phone);
          for (const l of hits) l.phone = data.phone;
          return { count: hits.length };
        },
      ),
    },
  };
}

describe("phoneSearchVariants: the shape the old normalizer stored", () => {
  it("a normalized non-9x number also looks for «+» plus its nine digits", () => {
    const typed = normalizePhone("33 412 55 67");
    expect(typed).toBe("+998334125567");
    expect(phoneSearchVariants(typed)).toContain("+334125567");
    expect(phoneSearchVariants("+998 88 123 45 67")).toContain("+881234567");
    // The canonical form stays first.
    expect(phoneSearchVariants(typed)[0]).toBe("+998334125567");
  });

  it("the old shape itself still reaches the canonical form", () => {
    expect(phoneSearchVariants("+334125567")).toContain("+998334125567");
  });

  it("a 9x number always got +998, so there is no old shape to look for", () => {
    expect(phoneSearchVariants("+998901234567")).not.toContain("+901234567");
  });
});

describe("decidePhoneOwner: a returning patient stored before LD-10", () => {
  async function decide(
    db: ReturnType<typeof fakeDb>,
    typed: string,
    probe: { fullName: string; birthYear: number | null },
    answer?: "same" | "other",
  ) {
    const { decidePhoneOwner } = await import("@/server/patient/phone-owner");
    return decidePhoneOwner(db as never, "c1", normalizePhone(typed), probe, answer);
  }

  it("reuses the old-shape card instead of creating a second one", async () => {
    const db = fakeDb([
      row({
        id: "p_old",
        fullName: "Каримова Дилноза",
        birthDate: new Date(Date.UTC(1985, 0, 1)),
        phone: "+334125567",
        phoneNormalized: "+334125567",
      }),
    ]);
    const d = await decide(db, "33 412 55 67", {
      fullName: "Каримова Дилноза",
      birthYear: 1985,
    });
    expect(d.kind).toBe("use");
    if (d.kind === "use") expect(d.card.id).toBe("p_old");
  });

  it("another name on the old-shape number is a question, not a silent new card", async () => {
    const db = fakeDb([
      row({
        id: "p_old",
        fullName: "Каримова Дилноза",
        phone: "+334125567",
        phoneNormalized: "+334125567",
      }),
    ]);
    const d = await decide(db, "+998 33 412 55 67", {
      fullName: "Каримов Тимур",
      birthYear: 2012,
    });
    expect(d).toEqual({
      kind: "ask",
      owner: { id: "p_old", fullName: "Каримова Дилноза", birthYear: null, unverified: false },
    });
  });

  it("finds a relative whose contact phone is in the old shape", async () => {
    const db = fakeDb([
      row({
        id: "p_mother",
        fullName: "Каримова Дилноза",
        phone: "+998334125567",
        phoneNormalized: "+998334125567",
      }),
      row({
        id: "p_son",
        fullName: "Каримов Тимур",
        birthDate: new Date(Date.UTC(2012, 0, 1)),
        phone: "+334125567",
        phoneNormalized: "contact:abc",
        phoneVerifiedAt: null,
      }),
    ]);
    const d = await decide(db, "33 412 55 67", { fullName: "Каримов Тимур", birthYear: 2012 });
    expect(d.kind).toBe("use");
    if (d.kind === "use") expect(d.card.id).toBe("p_son");
  });

  it("an old-shape Mini App claim is shown, and released when a new owner takes the number", async () => {
    const db = fakeDb([
      row({
        id: "p_claim",
        fullName: "Кто-то",
        phone: "+334125567",
        phoneNormalized: "+334125567",
        phoneVerifiedAt: null,
      }),
    ]);
    const d = await decide(db, "33 412 55 67", { fullName: "Азиз", birthYear: null });
    expect(d.kind).toBe("ask");

    const { releaseUnverifiedPhone } = await import("@/server/patient/phone-identity");
    const auditLog = { create: vi.fn(async () => ({ id: "a" })) };
    const tx = {
      ...db,
      patient: {
        ...db.patient,
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
          Object.assign(db.patients.find((r) => r.id === where.id)!, data);
          return { id: where.id };
        }),
      },
      auditLog,
    };
    const released = await releaseUnverifiedPhone(
      tx as never,
      "c1",
      normalizePhone("33 412 55 67"),
      "walkin_owner",
    );
    expect(released).toEqual(["p_claim"]);
    expect(db.patients[0].phoneNormalized).toBe("released:p_claim");
  });

  it("two cards on one number in two shapes: always the older one", async () => {
    const db = fakeDb([
      row({
        id: "p_new",
        fullName: "Каримова Дилноза",
        phone: "+998334125567",
        phoneNormalized: "+998334125567",
        createdAt: new Date("2026-09-26T00:00:00Z"),
      }),
      row({
        id: "p_old",
        fullName: "Каримова Дилноза",
        phone: "+334125567",
        phoneNormalized: "+334125567",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      }),
    ]);
    const { findVerifiedPhoneOwners } = await import("@/server/patient/phone-identity");
    const owners = await findVerifiedPhoneOwners(db as never, "c1", "+998334125567");
    expect(owners.map((o) => o.id)).toEqual(["p_old", "p_new"]);
    expect(db.patient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "asc" } }),
    );
  });
});

// Final review: the pair is often two people. The mother's card was stored
// as «+334125567»; her son was later typed with 998 at the kiosk, and the
// old lookup of the full number never saw her card, so he got his own
// verified card on «+998334125567». Taking the oldest owner alone asked him
// «Это Каримова Дилноза?» and, on «Нет», created a third card; his own card
// (and today's booking on it) was never offered.
describe("decidePhoneOwner: two people on the two shapes of one number", () => {
  function family() {
    return fakeDb([
      row({
        id: "p_mother",
        fullName: "Каримова Дилноза",
        birthDate: new Date(Date.UTC(1985, 0, 1)),
        phone: "+334125567",
        phoneNormalized: "+334125567",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      }),
      row({
        id: "p_son",
        patientNumber: 2,
        fullName: "Каримов Тимур",
        birthDate: new Date(Date.UTC(2012, 0, 1)),
        phone: "+998334125567",
        phoneNormalized: "+998334125567",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      }),
    ]);
  }
  async function decide(
    typed: string,
    probe: { fullName: string; birthYear: number | null },
    answer?: "same" | "other",
  ) {
    const { decidePhoneOwner } = await import("@/server/patient/phone-owner");
    return decidePhoneOwner(family() as never, "c1", normalizePhone(typed), probe, answer);
  }

  it("the son's name finds his own card, typed either way", async () => {
    for (const typed of ["+998 33 412 55 67", "33 412 55 67"]) {
      const d = await decide(typed, { fullName: "Каримов Тимур", birthYear: 2012 });
      expect(d.kind, typed).toBe("use");
      if (d.kind === "use") expect(d.card.id, typed).toBe("p_son");
    }
  });

  it("the mother's name finds hers", async () => {
    const d = await decide("+998 33 412 55 67", {
      fullName: "Каримова Дилноза",
      birthYear: 1985,
    });
    expect(d.kind).toBe("use");
    if (d.kind === "use") expect(d.card.id).toBe("p_mother");
  });

  it("no name matches: asks about the oldest, and «same» takes exactly that card", async () => {
    const probe = { fullName: "Каримова Мадина", birthYear: 2015 };
    const asked = await decide("+998 33 412 55 67", probe);
    expect(asked).toMatchObject({ kind: "ask", owner: { id: "p_mother" } });
    const same = await decide("+998 33 412 55 67", probe, "same");
    expect(same).toMatchObject({ kind: "use", card: { id: "p_mother" } });
    const other = await decide("+998 33 412 55 67", probe, "other");
    expect(other).toEqual({ kind: "create", asContact: true });
  });
});

describe("scripts/fix-ld10-local-phones: relatives' contact phones too", () => {
  function seed() {
    return fakeDb(
      [
        row({
          id: "p_mother",
          patientNumber: 10,
          fullName: "Каримова Дилноза",
          phone: "+334125567",
          phoneNormalized: "+334125567",
        }),
        row({
          id: "p_son",
          patientNumber: 11,
          fullName: "Каримов Тимур",
          phone: "+334125567",
          phoneNormalized: "contact:abc",
          phoneVerifiedAt: null,
        }),
        // A relative on a 9x number was always stored with +998.
        row({
          id: "p_other_son",
          patientNumber: 12,
          phone: "+998901234567",
          phoneNormalized: "contact:def",
          phoneVerifiedAt: null,
        }),
      ],
      [{ id: "lead_1", phone: "+881234567" }],
    );
  }

  it("a clash is listed with both names and birth years, not as a duplicate", async () => {
    const { fixLd10LocalPhones } = await import("../../scripts/fix-ld10-local-phones");
    const db = fakeDb([
      row({
        id: "p_mother",
        patientNumber: 10,
        fullName: "Каримова Дилноза",
        birthDate: new Date(Date.UTC(1985, 4, 1)),
        phone: "+334125567",
        phoneNormalized: "+334125567",
      }),
      row({
        id: "p_son",
        patientNumber: 11,
        fullName: "Каримов Тимур",
        phone: "+998334125567",
        phoneNormalized: "+998334125567",
      }),
    ]);
    const lines: string[] = [];
    const s = await fixLd10LocalPhones(db as never, true, (l) => lines.push(l));
    const out = lines.join("\n");
    expect(out).toContain("check before merging");
    expect(out).not.toMatch(/duplicate/i);
    expect(out).toContain("P-10 Каримова Дилноза, 1985 (p_mother) +334125567");
    expect(out).toContain("P-11 Каримов Тимур, birth year unknown (p_son) +998334125567");
    expect(s).toMatchObject({ sameNumber: 1, patientsWritten: 0 });
    // Neither card is touched.
    expect(db.patients.find((r) => r.id === "p_mother")!.phoneNormalized).toBe("+334125567");
  });

  it("dry run lists the contact phone and writes nothing", async () => {
    const { fixLd10LocalPhones } = await import("../../scripts/fix-ld10-local-phones");
    const db = seed();
    const lines: string[] = [];
    const s = await fixLd10LocalPhones(db as never, false, (l) => lines.push(l));
    expect(lines.join("\n")).toContain("P-11 (p_son)  +334125567 → +998334125567");
    expect(s.contactPhonesWritten).toBe(0);
    expect(db.patient.updateMany).not.toHaveBeenCalled();
    expect(db.lead.updateMany).not.toHaveBeenCalled();
    expect(db.patients.find((r) => r.id === "p_son")!.phone).toBe("+334125567");
  });

  it("APPLY moves the owner and her relative to +998 together, and a second run does nothing", async () => {
    const { fixLd10LocalPhones } = await import("../../scripts/fix-ld10-local-phones");
    const db = seed();
    const s = await fixLd10LocalPhones(db as never, true, () => {});
    expect(s).toMatchObject({ patientsWritten: 1, contactPhonesWritten: 1, leadsWritten: 1 });

    const mother = db.patients.find((r) => r.id === "p_mother")!;
    const son = db.patients.find((r) => r.id === "p_son")!;
    expect(mother.phoneNormalized).toBe("+998334125567");
    expect(son.phone).toBe("+998334125567");
    // His identity stays the stub: the number is still only his contact.
    expect(son.phoneNormalized).toBe("contact:abc");
    expect(db.patients.find((r) => r.id === "p_other_son")!.phone).toBe("+998901234567");
    expect(db.leads[0].phone).toBe("+998881234567");

    // The son is found again by the number reception types.
    const { findContactSharers } = await import("@/server/patient/phone-identity");
    const sharers = await findContactSharers(db as never, "c1", normalizePhone("33 412 55 67"));
    expect(sharers.map((x) => x.id)).toEqual(["p_son"]);

    const again = await fixLd10LocalPhones(db as never, true, () => {});
    expect(again).toMatchObject({
      patientsWritten: 0,
      contactPhonesWritten: 0,
      leadsWritten: 0,
      sameNumber: 0,
    });
  });

  it("a contact phone staff changed after the read is left alone", async () => {
    const { fixLd10LocalPhones } = await import("../../scripts/fix-ld10-local-phones");
    const db = seed();
    const son = db.patients.find((r) => r.id === "p_son")!;
    const findMany = db.patient.findMany.getMockImplementation()!;
    db.patient.findMany.mockImplementation(async (args) => {
      const out = await findMany(args);
      // Between the read and the write, reception typed a new number.
      if (args.where.phoneNormalized && typeof args.where.phoneNormalized !== "string" &&
        args.where.phoneNormalized.startsWith === "contact:") {
        son.phone = "+998935554433";
      }
      return out;
    });
    const s = await fixLd10LocalPhones(db as never, true, () => {});
    expect(s.contactPhonesWritten).toBe(0);
    expect(son.phone).toBe("+998935554433");
  });
});
