import { describe, expect, it, vi, beforeEach } from "vitest";

// The guard is pure orchestration over five counts — what matters is that it
// counts the RIGHT relations (the Restrict ones, i.e. real clinical history)
// and that `total` gates the delete. Prisma is mocked: this is a rules test,
// not a database test.
const counts = {
  appointment: 0,
  visitNote: 0,
  visitNoteAmendment: 0,
  prescription: 0,
  patientReview: 0,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: { count: vi.fn(async () => counts.appointment) },
    visitNote: { count: vi.fn(async () => counts.visitNote) },
    visitNoteAmendment: { count: vi.fn(async () => counts.visitNoteAmendment) },
    prescription: { count: vi.fn(async () => counts.prescription) },
    patientReview: { count: vi.fn(async () => counts.patientReview) },
    serviceOnDoctor: { findMany: vi.fn(async () => []) },
    service: { findMany: vi.fn(async () => []) },
  },
}));

const { countDoctorDeleteBlockers } = await import(
  "@/server/doctors/deactivation"
);

describe("countDoctorDeleteBlockers", () => {
  beforeEach(() => {
    counts.appointment = 0;
    counts.visitNote = 0;
    counts.visitNoteAmendment = 0;
    counts.prescription = 0;
    counts.patientReview = 0;
  });

  it("reports zero for a doctor who never worked — delete is allowed", async () => {
    const b = await countDoctorDeleteBlockers("doc-1");
    expect(b.total).toBe(0);
  });

  it("blocks on appointments alone", async () => {
    counts.appointment = 3;
    const b = await countDoctorDeleteBlockers("doc-1");
    expect(b.appointments).toBe(3);
    expect(b.total).toBe(3);
  });

  it("blocks on signed conclusions even without appointments", async () => {
    counts.visitNote = 1;
    const b = await countDoctorDeleteBlockers("doc-1");
    expect(b.total).toBe(1);
  });

  it("counts every clinical relation into the total", async () => {
    counts.appointment = 1;
    counts.visitNote = 2;
    counts.visitNoteAmendment = 3;
    counts.prescription = 4;
    counts.patientReview = 5;
    const b = await countDoctorDeleteBlockers("doc-1");
    expect(b.total).toBe(15);
  });
});
