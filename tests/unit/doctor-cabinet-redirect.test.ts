/**
 * The doctor-cabinet kill switch must never trap anyone.
 *
 * Two layouts guard this surface from opposite ends — `/doctor` bounces to
 * CRM when the cabinet is off, `/crm` bounces a DOCTOR to the cabinet. When
 * those guards disagreed, flipping the switch off produced an infinite
 * redirect loop (ERR_TOO_MANY_REDIRECTS) and locked every doctor out of the
 * product. e2e caught it; this pins the invariant so it can't come back.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  isDoctorCabinetEnabled,
  shouldRedirectDoctorToCabinet,
} from "@/lib/doctor-cabinet";

const ORIGINAL = process.env.DOCTOR_CABINET_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DOCTOR_CABINET_ENABLED;
  else process.env.DOCTOR_CABINET_ENABLED = ORIGINAL;
});

/** Mirrors the guard in src/app/[locale]/doctor/layout.tsx. */
const doctorLayoutBouncesToCrm = () => !isDoctorCabinetEnabled();

describe("doctor cabinet kill switch", () => {
  it("never has both guards redirecting at once — the loop condition", () => {
    for (const value of ["1", "0", "", "true", undefined]) {
      if (value === undefined) delete process.env.DOCTOR_CABINET_ENABLED;
      else process.env.DOCTOR_CABINET_ENABLED = value;

      const crmSendsToCabinet = shouldRedirectDoctorToCabinet("DOCTOR");
      const cabinetSendsToCrm = doctorLayoutBouncesToCrm();

      expect(
        crmSendsToCabinet && cabinetSendsToCrm,
        `both guards redirect when DOCTOR_CABINET_ENABLED=${String(value)}`,
      ).toBe(false);
    }
  });

  it("routes the doctor to the cabinet while it is enabled", () => {
    process.env.DOCTOR_CABINET_ENABLED = "1";
    expect(isDoctorCabinetEnabled()).toBe(true);
    expect(shouldRedirectDoctorToCabinet("DOCTOR")).toBe(true);
  });

  it("keeps the doctor in CRM while the cabinet is switched off", () => {
    process.env.DOCTOR_CABINET_ENABLED = "0";
    expect(shouldRedirectDoctorToCabinet("DOCTOR")).toBe(false);
    // ...and the cabinet still refuses to render, so the switch works.
    expect(doctorLayoutBouncesToCrm()).toBe(true);
  });

  it("treats anything other than exactly \"1\" as off", () => {
    for (const value of ["", "0", "true", "yes", "01"]) {
      process.env.DOCTOR_CABINET_ENABLED = value;
      expect(isDoctorCabinetEnabled(), `value=${value}`).toBe(false);
    }
  });

  it("leaves non-doctor roles alone in CRM", () => {
    process.env.DOCTOR_CABINET_ENABLED = "1";
    for (const role of ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR", undefined]) {
      expect(shouldRedirectDoctorToCabinet(role)).toBe(false);
    }
  });
});
