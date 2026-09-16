/**
 * A doctor books into his OWN schedule only.
 *
 * Booking used to be reception-only, but patients arrange the next visit with
 * the doctor at the end of this one — sending him to the front desk for that
 * was the wrong shape. Opening `POST /api/crm/appointments` to DOCTOR brings
 * the same risk the walk-in route had: filling a colleague's calendar. So the
 * Doctor row is resolved from the session and any other `doctorId` is refused.
 *
 * Same decision table as `walkin-doctor-scope.test.ts`, deliberately —
 * the two entry points must not drift apart.
 */
import { describe, expect, it } from "vitest";

type Role = "ADMIN" | "RECEPTIONIST" | "DOCTOR";
type Self = { id: string; isActive: boolean } | null;

/** The route's authorization branch, extracted in shape. */
function resolveBookingDoctor(args: {
  role: Role;
  bodyDoctorId: string;
  self: Self;
}): { ok: true; doctorId: string } | { ok: false; status: number; error: string } {
  const { role, bodyDoctorId, self } = args;
  if (role !== "DOCTOR") return { ok: true, doctorId: bodyDoctorId };
  if (!self) return { ok: false, status: 404, error: "doctor_not_found" };
  if (!self.isActive) return { ok: false, status: 403, error: "Forbidden" };
  if (bodyDoctorId !== self.id) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, doctorId: self.id };
}

const SELF = { id: "doc_self", isActive: true };

describe("booking scope — DOCTOR", () => {
  it("allows booking into his own schedule", () => {
    expect(
      resolveBookingDoctor({ role: "DOCTOR", bodyDoctorId: "doc_self", self: SELF }),
    ).toEqual({ ok: true, doctorId: "doc_self" });
  });

  it("refuses booking into a colleague's schedule", () => {
    expect(
      resolveBookingDoctor({
        role: "DOCTOR",
        bodyDoctorId: "doc_colleague",
        self: SELF,
      }),
    ).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("refuses a deactivated doctor even for his own id", () => {
    expect(
      resolveBookingDoctor({
        role: "DOCTOR",
        bodyDoctorId: "doc_self",
        self: { id: "doc_self", isActive: false },
      }),
    ).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("404s when the account has no doctor card linked", () => {
    expect(
      resolveBookingDoctor({ role: "DOCTOR", bodyDoctorId: "doc_self", self: null }),
    ).toEqual({ ok: false, status: 404, error: "doctor_not_found" });
  });

  it("never trusts the body id when it merely looks self-referential", () => {
    expect(
      resolveBookingDoctor({
        role: "DOCTOR",
        bodyDoctorId: "doc_self ",
        self: SELF,
      }).ok,
    ).toBe(false);
  });
});

describe("booking scope — front desk keeps free choice", () => {
  for (const role of ["ADMIN", "RECEPTIONIST"] as const) {
    it(`${role} may book for any doctor`, () => {
      expect(
        resolveBookingDoctor({ role, bodyDoctorId: "doc_anyone", self: null }),
      ).toEqual({ ok: true, doctorId: "doc_anyone" });
    });
  }
});
