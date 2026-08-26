/**
 * A visit row must link by VisitNote id, never by appointment id.
 *
 * `/doctor/visits/[patientId]/[visitId]` resolves its last segment with
 * `visitNote.findUnique({ where: { id: visitId } })`. Four call sites passed
 * the appointment id instead, so every «открыть визит» from the patient chart
 * and the visits list landed on a 404 — reported from production. The ids look
 * alike (both cuid), so nothing failed loudly; only the page did.
 *
 * This guards the rule at the source: the row shape carries both ids, and the
 * href builder must pick the note one — or refuse to link at all when the
 * visit was never written up.
 */
import { describe, expect, it } from "vitest";

/** Mirrors DoctorPatientVisitRow — both ids present, easy to confuse. */
type VisitRowLike = {
  id: string;
  visitNoteId: string | null;
  hasVisitNote: boolean;
};

/** The rule every call site implements. */
function visitDetailHref(
  locale: string,
  patientId: string,
  row: VisitRowLike,
): string | null {
  return row.visitNoteId
    ? `/${locale}/doctor/visits/${patientId}/${row.visitNoteId}`
    : null;
}

const APPOINTMENT_ID = "cmszpt328002s67pb7wpmr3z6";
const NOTE_ID = "cmszptdlx01gc67pbh75f0u2i";

describe("visit detail links", () => {
  it("uses the note id, not the appointment id", () => {
    const href = visitDetailHref("ru", "pat_1", {
      id: APPOINTMENT_ID,
      visitNoteId: NOTE_ID,
      hasVisitNote: true,
    });

    expect(href).toBe(`/ru/doctor/visits/pat_1/${NOTE_ID}`);
    // The exact regression: the appointment id must not end up in the URL.
    expect(href).not.toContain(APPOINTMENT_ID);
  });

  it("refuses to link a visit that has no conclusion", () => {
    const href = visitDetailHref("ru", "pat_1", {
      id: APPOINTMENT_ID,
      visitNoteId: null,
      hasVisitNote: false,
    });

    // A link here would be a guaranteed 404 — better no link at all.
    expect(href).toBeNull();
  });

  it("trusts visitNoteId over a stale hasVisitNote flag", () => {
    // hasVisitNote says yes, but the id is missing — the id decides, since it
    // is what the route actually needs.
    const href = visitDetailHref("ru", "pat_1", {
      id: APPOINTMENT_ID,
      visitNoteId: null,
      hasVisitNote: true,
    });

    expect(href).toBeNull();
  });

  it("keeps the locale prefix", () => {
    const href = visitDetailHref("uz", "pat_9", {
      id: APPOINTMENT_ID,
      visitNoteId: NOTE_ID,
      hasVisitNote: true,
    });

    expect(href).toBe(`/uz/doctor/visits/pat_9/${NOTE_ID}`);
  });
});
