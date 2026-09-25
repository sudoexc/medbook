import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Audit DC-02 — the doctor cabinet was outside every session check.
 *
 * The proxy's gates (session lifetime, forced password change, mandatory 2FA)
 * only matched /crm, and the account pages only lived under /crm/me/…, where
 * the CRM layout bounces every doctor back to /doctor. So a doctor could never
 * change a temporary password, and «2FA for everyone» left the cabinet dead.
 * Now both surfaces are gated and a doctor's account pages live in the cabinet.
 */
import {
  accountSurfaceFor,
  forcedAccountRedirect,
  parseStaffPath,
} from "@/server/auth/staff-redirects";

const ROOT = path.resolve(__dirname, "../..");
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.DOCTOR_CABINET_ENABLED;
  process.env.DOCTOR_CABINET_ENABLED = "1";
});
afterEach(() => {
  if (saved === undefined) delete process.env.DOCTOR_CABINET_ENABLED;
  else process.env.DOCTOR_CABINET_ENABLED = saved;
});

describe("parseStaffPath", () => {
  it("covers the doctor cabinet as well as the CRM, with or without a locale", () => {
    expect(parseStaffPath("/ru/doctor/my-day")).toEqual({ locale: "ru", surface: "doctor", subpath: "my-day" });
    expect(parseStaffPath("/doctor")).toEqual({ locale: "ru", surface: "doctor", subpath: "" });
    expect(parseStaffPath("/uz/crm/patients")).toEqual({ locale: "uz", surface: "crm", subpath: "patients" });
    expect(parseStaffPath("/ru/doctors")).toBeNull(); // the public doctors page
    expect(parseStaffPath("/")).toBeNull();
  });
});

describe("forcedAccountRedirect", () => {
  it("a doctor with a temporary password lands on the cabinet's change-password page", () => {
    expect(
      forcedAccountRedirect({ subpath: "my-day", role: "DOCTOR", mustChangePassword: true, owesTotpEnrolment: false }),
    ).toEqual({ kind: "change-password", target: "doctor/me/change-password" });
  });

  it("...and can stay there to submit the form (no redirect loop)", () => {
    expect(
      forcedAccountRedirect({ subpath: "me/change-password", role: "DOCTOR", mustChangePassword: true, owesTotpEnrolment: true }),
    ).toBeNull();
  });

  it("with 2FA required for everyone, an unenrolled doctor is sent to enrol in the cabinet", () => {
    expect(
      forcedAccountRedirect({ subpath: "my-day", role: "DOCTOR", mustChangePassword: false, owesTotpEnrolment: true }),
    ).toEqual({ kind: "security", target: "doctor/me/security" });
    expect(
      forcedAccountRedirect({ subpath: "me/security", role: "DOCTOR", mustChangePassword: false, owesTotpEnrolment: true }),
    ).toBeNull();
  });

  it("other roles keep their CRM account pages", () => {
    expect(
      forcedAccountRedirect({ subpath: "patients", role: "RECEPTIONIST", mustChangePassword: true, owesTotpEnrolment: false }),
    ).toEqual({ kind: "change-password", target: "crm/me/change-password" });
    expect(
      forcedAccountRedirect({ subpath: "", role: "ADMIN", mustChangePassword: false, owesTotpEnrolment: true }),
    ).toEqual({ kind: "security", target: "crm/me/security" });
  });

  it("with the cabinet switched off, a doctor uses the CRM pages (which then keep them)", () => {
    process.env.DOCTOR_CABINET_ENABLED = "0";
    expect(accountSurfaceFor("DOCTOR")).toBe("crm");
  });

  it("nothing pending, nothing forced", () => {
    expect(
      forcedAccountRedirect({ subpath: "my-day", role: "DOCTOR", mustChangePassword: false, owesTotpEnrolment: false }),
    ).toBeNull();
  });
});

describe("the cabinet serves the account pages itself", () => {
  it("/doctor/me/change-password and /doctor/me/security exist and reuse the CRM pages", () => {
    for (const [doctorPage, crmPage] of [
      ["doctor/me/change-password/page.tsx", "crm/me/change-password/page"],
      ["doctor/me/security/page.tsx", "crm/me/security/page"],
    ]) {
      const file = path.join(ROOT, "src/app/[locale]", doctorPage!);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toContain(`@/app/[locale]/${crmPage}`);
    }
  });

  it("the cabinet's security tab links inside the cabinet, not to /crm/me/security", () => {
    const tab = readFileSync(
      path.join(ROOT, "src/app/[locale]/doctor/settings/_components/security-tab.tsx"),
      "utf8",
    );
    expect(tab).toContain("/doctor/me/security");
    expect(tab).toContain("/doctor/me/change-password");
    expect(tab).not.toContain("href={`/${locale}/crm/me/security`}");
  });

  it("the proxy gates the doctor cabinet, not only /crm", () => {
    const proxy = readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
    expect(proxy).toContain("parseStaffPath(pathname)");
    expect(proxy).not.toMatch(/const CRM_PATH\b/);
  });
});
