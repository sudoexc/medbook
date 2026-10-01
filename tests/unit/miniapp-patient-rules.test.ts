/**
 * The Mini App's client-side halves of MA-15, MA-17, MA-18 and MA-19.
 *
 *   - MA-15/17: the sheet and the routes read one rule for what a patient
 *     may cancel or move, and refusals read as text, never as a raw code
 *     («doctor_busy»), in both languages.
 *   - MA-18: links keep the relative chosen in the switcher, and her «new
 *     results» marker is her own.
 *   - MA-19: the referral program is off until built end to end: no setting,
 *     no CRM block, no Mini App endpoint minting codes nobody can redeem.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isPatientCancellable,
  patientRescheduleRefusal,
} from "@/lib/appointments/patient-reschedule";
import { miniAppActionErrorText } from "@/app/c/[slug]/my/_lib/action-errors";
import { myHref } from "@/app/c/[slug]/my/_lib/booking-context";
import { readLabsSeenAt, writeLabsSeenAt } from "@/app/c/[slug]/my/_lib/labs-unseen";
import { ruDict } from "@/app/c/[slug]/my/_messages/ru";
import { uzDict } from "@/app/c/[slug]/my/_messages/uz";
import { REFERRAL_PROGRAM_LIVE } from "@/lib/patient-experience/referral-reward";

const ROOT = join(__dirname, "..", "..");

describe("what a patient may cancel (MA-15)", () => {
  it("until the visit reaches the doctor", () => {
    for (const s of ["BOOKED", "CONFIRMED", "WAITING", "SKIPPED"]) {
      expect(isPatientCancellable(s), s).toBe(true);
    }
    for (const s of ["IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]) {
      expect(isPatientCancellable(s), s).toBe(false);
    }
  });
});

describe("what a patient may move (MA-17)", () => {
  it("only a booking that has not reached the clinic", () => {
    expect(patientRescheduleRefusal({ status: "BOOKED", channel: "TELEGRAM" })).toBeNull();
    expect(patientRescheduleRefusal({ status: "CONFIRMED", channel: "PHONE" })).toBeNull();
    expect(patientRescheduleRefusal({ status: "BOOKED", channel: "WALKIN" })).toBe("not_reschedulable");
    expect(patientRescheduleRefusal({ status: "WAITING" })).toBe("not_reschedulable");
    expect(patientRescheduleRefusal({ status: "SKIPPED" })).toBe("not_reschedulable");
    expect(
      patientRescheduleRefusal({ status: "CONFIRMED", arrivedAt: "2026-10-01T04:58:00Z" }),
    ).toBe("not_reschedulable");
    for (const s of ["NO_SHOW", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
      expect(patientRescheduleRefusal({ status: s }), s).toBe("not_editable");
    }
    // A finished visit with a check-in stamp is still «finished», not «arrived».
    expect(patientRescheduleRefusal({ status: "COMPLETED", arrivedAt: new Date() })).toBe("not_editable");
  });
});

describe("refusals read as text (MA-17)", () => {
  const err = (data: Record<string, unknown>, message = "x") =>
    Object.assign(new Error(message), { data });

  it("every code the routes answer has its own sentence", () => {
    const t = ruDict;
    expect(miniAppActionErrorText(err({ error: "conflict", reason: "doctor_busy" }), t)).toBe(
      t.book.errorConflict,
    );
    expect(
      miniAppActionErrorText(err({ error: "conflict", reason: "booking_limit", limit: "patient_doctor" }), t),
    ).toBe(t.book.errorLimitDoctor);
    expect(
      miniAppActionErrorText(err({ error: "conflict", reason: "booking_limit", limit: "patient_total" }), t),
    ).toBe(t.book.errorLimitTotal.replace("{count}", "3"));
    expect(miniAppActionErrorText(err({ error: "beyond_horizon" }), t)).toBe(
      t.book.errorBeyondHorizon.replace("{days}", "14"),
    );
    expect(miniAppActionErrorText(err({ error: "off_grid" }), t)).toBe(t.book.errorOffGrid);
    expect(miniAppActionErrorText(err({ error: "in_past" }), t)).toBe(t.book.errorPast);
    expect(miniAppActionErrorText(err({ error: "rate_limited" }), t)).toBe(t.book.errorRateLimited);
    expect(miniAppActionErrorText(err({ error: "not_reschedulable" }), t)).toBe(t.appts.rescheduleArrived);
    expect(miniAppActionErrorText(err({ error: "not_cancellable" }), t)).toBe(t.appts.notEditable);
    expect(miniAppActionErrorText(err({ error: "has_payment" }), t)).toBe(t.appts.paymentLocked);
    // Unknown codes never reach the patient raw.
    const unknown = miniAppActionErrorText(err({ error: "on_behalf_of_not_linked" }), t);
    expect(unknown).toBe(t.book.errorGeneric);
    expect(miniAppActionErrorText(new Error("Failed to fetch"), t)).toBe(t.book.errorGeneric);
  });

  it("no message shows a code, nor a dash, in either language", () => {
    for (const t of [ruDict, uzDict]) {
      for (const reason of ["doctor_busy", "booking_limit", "off_grid", "not_editable", "outside_schedule"]) {
        const text = miniAppActionErrorText(err({ error: "conflict", reason }), t);
        expect(text).not.toMatch(/[a-z]+_[a-z]+/);
        expect(text).not.toMatch(/[—–]/);
      }
      for (const v of [t.visit.amendmentsTitle, t.visit.amendmentsHint, t.visit.amendmentReason]) {
        expect(v).not.toMatch(/[—–]/);
      }
    }
  });
});

describe("links keep the relative (MA-18)", () => {
  it("myHref", () => {
    expect(myHref("neurofax", "labs", null)).toBe("/c/neurofax/my/labs");
    expect(myHref("neurofax", "visit/apt_1", "p_mama")).toBe("/c/neurofax/my/visit/apt_1?onBehalfOf=p_mama");
    expect(myHref("neurofax", "", "p_mama")).toBe("/c/neurofax/my?onBehalfOf=p_mama");
  });

  describe("«new results» marker per card", () => {
    const store = new Map<string, string>();
    beforeEach(() => {
      store.clear();
      (globalThis as { window?: unknown }).window = {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
        },
      };
    });
    afterEach(() => {
      delete (globalThis as { window?: unknown }).window;
    });

    it("opening the owner's results does not mark the mother's as seen", () => {
      writeLabsSeenAt("neurofax", 1000);
      expect(readLabsSeenAt("neurofax")).toBe(1000);
      expect(readLabsSeenAt("neurofax", "p_mama")).toBeNull();
      writeLabsSeenAt("neurofax", 2000, "p_mama");
      expect(readLabsSeenAt("neurofax", "p_mama")).toBe(2000);
      expect(readLabsSeenAt("neurofax")).toBe(1000);
    });
  });
});

describe("referral program stays off until built (MA-19)", () => {
  it("is not live", () => {
    expect(REFERRAL_PROGRAM_LIVE).toBe(false);
  });

  it("the Mini App endpoint that minted codes nobody could redeem is gone", () => {
    expect(existsSync(join(ROOT, "src/app/api/miniapp/referral/route.ts"))).toBe(false);
  });

  it("the clinic setting and the patient card block are behind the switch", () => {
    const settings = readFileSync(
      join(ROOT, "src/app/[locale]/crm/settings/clinic/_components/clinic-settings-client.tsx"),
      "utf8",
    );
    expect(settings).toMatch(/\{REFERRAL_PROGRAM_LIVE \? \(\s*<div>\s*<Label htmlFor="referralRewardPercent">/);
    const card = readFileSync(
      join(ROOT, "src/app/[locale]/crm/patients/[id]/_components/patient-card-client.tsx"),
      "utf8",
    );
    expect(card).toMatch(/\{REFERRAL_PROGRAM_LIVE \? \(\s*<PatientReferralCard/);
  });
});
