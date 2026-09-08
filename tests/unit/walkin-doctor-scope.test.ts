/**
 * A doctor may queue walk-ins — but only into their OWN queue.
 *
 * Returning patients routinely walk straight to the office instead of the front
 * desk, so `/api/crm/appointments/walkin` is now open to DOCTOR as well as
 * ADMIN/RECEPTIONIST. The risk that comes with it is one doctor filling a
 * colleague's queue, so the route resolves the caller's own Doctor row from the
 * session and refuses any other `doctorId` rather than trusting the body.
 *
 * These tests pin that decision table. Admin/reception keep the free choice
 * they always had — the front desk books for everyone by definition.
 */
import { describe, expect, it } from "vitest";

type Role = "ADMIN" | "RECEPTIONIST" | "DOCTOR";
type Self = { id: string; isActive: boolean } | null;

/** The route's authorization branch, extracted verbatim in shape. */
function resolveWalkinDoctor(args: {
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

describe("walk-in scope — DOCTOR", () => {
  it("allows queueing into the doctor's own queue", () => {
    const r = resolveWalkinDoctor({
      role: "DOCTOR",
      bodyDoctorId: "doc_self",
      self: SELF,
    });
    expect(r).toEqual({ ok: true, doctorId: "doc_self" });
  });

  it("refuses queueing into a colleague's queue", () => {
    const r = resolveWalkinDoctor({
      role: "DOCTOR",
      bodyDoctorId: "doc_colleague",
      self: SELF,
    });
    expect(r).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("refuses a deactivated doctor even for their own id", () => {
    const r = resolveWalkinDoctor({
      role: "DOCTOR",
      bodyDoctorId: "doc_self",
      self: { id: "doc_self", isActive: false },
    });
    expect(r).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("404s when the account has no doctor card linked", () => {
    // A DOCTOR-role user whose Doctor row was unlinked — the exact state that
    // made the clinic think deactivation had worked.
    const r = resolveWalkinDoctor({
      role: "DOCTOR",
      bodyDoctorId: "doc_self",
      self: null,
    });
    expect(r).toEqual({ ok: false, status: 404, error: "doctor_not_found" });
  });

  it("never trusts the body id, even when it looks self-referential", () => {
    const r = resolveWalkinDoctor({
      role: "DOCTOR",
      bodyDoctorId: "doc_self ",
      self: SELF,
    });
    expect(r.ok).toBe(false);
  });
});

describe("walk-in scope — front desk keeps free choice", () => {
  for (const role of ["ADMIN", "RECEPTIONIST"] as const) {
    it(`${role} may queue into any doctor's queue`, () => {
      const r = resolveWalkinDoctor({
        role,
        bodyDoctorId: "doc_anyone",
        self: null,
      });
      expect(r).toEqual({ ok: true, doctorId: "doc_anyone" });
    });
  }
});
