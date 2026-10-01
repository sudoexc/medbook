/**
 * Doctor profile editors (audit DR-10, DR-04), pure parts.
 *
 *   DR-10  The services editor skipped a row whose duration was out of range
 *          («3» typed for 30) and PUT replaces the whole set, so the service
 *          was silently unlinked under a «Сохранено» toast. A background
 *          refetch also overwrote unsaved edits.
 *   DR-04  The CRM had no form to edit a doctor at all. The new dialog sends
 *          only what changed, so a legacy value the stricter schema would
 *          refuse never blocks an unrelated edit.
 */
import { describe, expect, it } from "vitest";

import {
  adoptBaseline,
  assignmentsEqual,
  buildAssignments,
  rowProblem,
  type AssignmentState,
} from "@/app/[locale]/crm/doctors/[id]/_components/doctor-services-state";
import {
  buildDoctorPatch,
  formFromDoctor,
} from "@/app/[locale]/crm/doctors/[id]/_components/edit-doctor-form";
import type { DoctorDetail } from "@/app/[locale]/crm/doctors/[id]/_hooks/use-doctor";
import { DoctorServiceAssignmentSchema } from "@/server/schemas/doctor-services";
import { DoctorServiceLinkSchema } from "@/server/schemas/doctor";

const row = (over: Partial<AssignmentState> = {}): AssignmentState => ({
  assigned: true,
  priceInput: "",
  durationInput: "",
  ...over,
});

describe("DR-10: an invalid row blocks saving instead of unlinking the service", () => {
  it("duration «3» is a problem; nothing is dropped from the PUT", () => {
    const state = { eeg: row({ durationInput: "3" }), consult: row() };
    expect(rowProblem(state.eeg)).toEqual({ duration: true });
    const built = buildAssignments(state);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(Object.keys(built.invalid)).toEqual(["eeg"]);
  });

  it("valid rows become the full set, сумы converted to tiyin", () => {
    const built = buildAssignments({
      consult: row({ priceInput: "300000", durationInput: "45" }),
      eeg: row(),
      off: row({ assigned: false, durationInput: "3" }),
    });
    expect(built).toEqual({
      ok: true,
      assignments: [
        { serviceId: "consult", priceOverride: 30_000_000, durationMinOverride: 45 },
        { serviceId: "eeg", priceOverride: null, durationMinOverride: null },
      ],
    });
  });

  it("the editor's bounds are the schemas' bounds (5..480, one rule)", () => {
    expect(rowProblem(row({ durationInput: "5" }))).toBeNull();
    expect(rowProblem(row({ durationInput: "480" }))).toBeNull();
    expect(rowProblem(row({ durationInput: "481" }))).toEqual({ duration: true });
    expect(rowProblem(row({ durationInput: "4" }))).toEqual({ duration: true });
    for (const schema of [DoctorServiceAssignmentSchema, DoctorServiceLinkSchema]) {
      expect(schema.safeParse({ serviceId: "s", durationMinOverride: 480 }).success).toBe(true);
      expect(schema.safeParse({ serviceId: "s", durationMinOverride: 481 }).success).toBe(false);
      expect(schema.safeParse({ serviceId: "s", durationMinOverride: 4 }).success).toBe(false);
    }
  });

  it("a price beyond the int4 column is a problem, not a 500", () => {
    expect(rowProblem(row({ priceInput: "99999999" }))).toEqual({ price: true });
    expect(rowProblem(row({ priceInput: "21000000" }))).toBeNull();
  });
});

describe("DR-10: a refetch never overwrites unsaved edits", () => {
  const server = { consult: row({ priceInput: "200000" }) };

  it("untouched editor adopts the new server state", () => {
    const next = { consult: row({ priceInput: "250000" }) };
    expect(adoptBaseline(server, server, next)).toBe(next);
  });

  it("an editor with edits keeps them", () => {
    const edited = { consult: row({ priceInput: "300000" }) };
    const next = { consult: row({ priceInput: "250000" }) };
    expect(adoptBaseline(edited, server, next)).toBe(edited);
  });

  it("first load (empty editor, empty baseline) adopts the data", () => {
    expect(adoptBaseline({}, {}, server)).toBe(server);
  });

  it("a remount over cached queries shows the doctor's services, not an empty editor", () => {
    // Review of DR-10: opening the same doctor again within the cache time
    // has the baseline on the first render. The editor used to start empty
    // with that baseline as «previous», so «empty» read as an edit, stayed,
    // and Save replaced his whole set with what was ticked on top of nothing.
    const cached = {
      consult: row({ priceInput: "300000" }),
      eeg: row({ durationInput: "45" }),
      mri: row({ assigned: false }),
    };
    // The component starts from the baseline and its first sync passes null.
    const first = adoptBaseline(cached, null, cached);
    expect(first).toBe(cached);
    expect(assignmentsEqual(first, cached)).toBe(true); // nothing dirty, Save off
    // Even an empty start is replaced by the first sync, never kept as an edit.
    expect(adoptBaseline({}, null, cached)).toBe(cached);
    // After it, the rule is the usual one: edits survive a refetch.
    const edited = { ...cached, mri: row() };
    expect(adoptBaseline(edited, cached, cached)).toBe(edited);
  });

  it("a missing row reads as unassigned, and inputs of unassigned rows do not count", () => {
    expect(assignmentsEqual({}, { x: row({ assigned: false, priceInput: "5" }) })).toBe(true);
    expect(assignmentsEqual({}, { x: row() })).toBe(false);
  });
});

const doctor = (over: Partial<DoctorDetail> = {}): DoctorDetail =>
  ({
    id: "d1",
    slug: "sultanov-aziz",
    nameRu: "Султанов Азиз",
    nameUz: "Sultonov Aziz",
    specializationRu: "Невролог",
    specializationUz: "Nevrolog",
    photoUrl: "/files/legacy-photo.jpg",
    bioRu: null,
    bioUz: null,
    color: "#3DD5C0",
    pricePerVisit: 200_000_00,
    salaryPercent: 40,
    ...over,
  }) as DoctorDetail;

describe("DR-04: the edit form sends what changed", () => {
  it("an unchanged form sends nothing", () => {
    const d = doctor();
    expect(buildDoctorPatch(d, formFromDoctor(d))).toEqual({ ok: true, patch: {} });
  });

  it("surname and visit price (typed in сумы) are sent, the legacy photo path is not", () => {
    const d = doctor();
    const form = { ...formFromDoctor(d), nameRu: "Султанов Азиз Бахтиёрович", pricePerVisit: "250000" };
    expect(form.pricePerVisit).toBe("250000");
    expect(formFromDoctor(d).pricePerVisit).toBe("200000");
    expect(buildDoctorPatch(d, form)).toEqual({
      ok: true,
      patch: { nameRu: "Султанов Азиз Бахтиёрович", pricePerVisit: 25_000_000 },
    });
  });

  it("clearing the price or the bio sends null", () => {
    const d = doctor({ bioRu: "Стаж 10 лет" });
    const form = { ...formFromDoctor(d), pricePerVisit: "", bioRu: "" };
    expect(buildDoctorPatch(d, form)).toEqual({
      ok: true,
      patch: { pricePerVisit: null, bioRu: null },
    });
  });

  it("refuses an empty name, a bad slug, a salary over 100 or a non-http photo", () => {
    const d = doctor();
    const base = formFromDoctor(d);
    expect(buildDoctorPatch(d, { ...base, nameUz: "  " })).toEqual({ ok: false, field: "nameUz" });
    expect(buildDoctorPatch(d, { ...base, slug: "A" })).toEqual({ ok: false, field: "slug" });
    expect(buildDoctorPatch(d, { ...base, salaryPercent: "101" })).toEqual({
      ok: false,
      field: "salaryPercent",
    });
    expect(buildDoctorPatch(d, { ...base, photoUrl: "javascript:alert(1)" })).toEqual({
      ok: false,
      field: "photoUrl",
    });
  });

  it("salary and colour changes are sent as numbers / hex", () => {
    const d = doctor();
    const form = { ...formFromDoctor(d), salaryPercent: "45", color: "#3B82F6" };
    expect(buildDoctorPatch(d, form)).toEqual({
      ok: true,
      patch: { salaryPercent: 45, color: "#3B82F6" },
    });
  });
});
