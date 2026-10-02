/**
 * P6 lane B3, the CRM chrome (topbar, switchers):
 *
 *   - CM-21: see p6-b3-clinic-entry.test.ts (the entry dialog).
 *   - CM-23: a branch switch drops the TanStack Query cache.
 *   - CM-24: the topbar language switch is saved to the profile, which
 *     sign-in copies back into the cookie.
 *   - CM-26: the topbar offers only what the role and plan allow, and every
 *     CRM section has its own title.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BOOKING_ROLES,
  CRM_SECTION_KEY,
  WALKIN_TICKET_ROLES,
  crmSectionKey,
  topbarActions,
} from "@/lib/crm-topbar";
import { DEFAULT_FLAGS, ENTERPRISE_FLAGS } from "@/lib/feature-flags";
import { persistUiLocale } from "@/lib/ui-locale-client";

const ROOT = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("CM-23: branch switch", () => {
  it("resets the query cache before refreshing the server render", () => {
    const s = src("src/components/layout/branch-switcher.tsx");
    const reset = s.indexOf("queryClient.resetQueries()");
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(s.indexOf("router.refresh()", reset));
  });
});

describe("CM-24: UI language is saved to the profile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the cookie and PATCHes /api/me", () => {
    const doc = { cookie: "" };
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("document", doc);
    vi.stubGlobal("fetch", fetchMock);
    persistUiLocale("uz");
    expect(doc.cookie).toMatch(/^NEXT_LOCALE=uz; Path=\//);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ locale: "uz" }) }),
    );
  });

  it("a failed PATCH never throws into the switch", async () => {
    vi.stubGlobal("document", { cookie: "" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(() => persistUiLocale("ru")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("the CRM topbar and the public switcher both go through it", () => {
    for (const file of [
      "src/components/layout/crm-topbar.tsx",
      "src/components/layout/language-switcher.tsx",
    ]) {
      const s = src(file);
      expect(s).toContain("persistUiLocale(next)");
      expect(s).not.toContain("document.cookie");
    }
  });
});

describe("CM-26: topbar actions by role and plan", () => {
  it("a nurse gets neither the ticket button nor booking", () => {
    expect(topbarActions("NURSE", ENTERPRISE_FLAGS)).toMatchObject({
      walkinTicket: false,
      booking: false,
      calls: false,
    });
  });

  it("the call operator books and takes calls, but issues no tickets", () => {
    expect(topbarActions("CALL_OPERATOR", ENTERPRISE_FLAGS)).toEqual({
      walkinTicket: false,
      booking: true,
      calls: true,
      telegram: true,
    });
  });

  it("the desk, the doctor, the admin and SUPER_ADMIN keep the ticket button", () => {
    for (const role of ["RECEPTIONIST", "DOCTOR", "ADMIN", "SUPER_ADMIN"]) {
      expect(topbarActions(role, ENTERPRISE_FLAGS).walkinTicket).toBe(true);
      expect(topbarActions(role, ENTERPRISE_FLAGS).booking).toBe(true);
    }
    // A doctor is not on the calls API's list.
    expect(topbarActions("DOCTOR", ENTERPRISE_FLAGS).calls).toBe(false);
  });

  it("a plan without the modules shows no Calls or Telegram icon", () => {
    const a = topbarActions("RECEPTIONIST", DEFAULT_FLAGS);
    expect(DEFAULT_FLAGS.hasCallCenter).toBe(false);
    expect(DEFAULT_FLAGS.hasTelegramInbox).toBe(false);
    expect(a.calls).toBe(false);
    expect(a.telegram).toBe(false);
  });

  it("no session, no actions", () => {
    expect(topbarActions(null, ENTERPRISE_FLAGS)).toEqual({
      walkinTicket: false,
      booking: false,
      calls: false,
      telegram: false,
    });
  });

  it("the role lists are the ones the APIs check", () => {
    expect(src("src/app/api/crm/appointments/walkin/route.ts")).toContain(
      "roles: [...WALKIN_TICKET_ROLES]",
    );
    expect(WALKIN_TICKET_ROLES).toEqual(["ADMIN", "RECEPTIONIST", "DOCTOR"]);
    for (const file of [
      "src/app/api/crm/appointments/route.ts",
      "src/app/api/crm/patients/route.ts",
    ]) {
      const s = src(file);
      const post = s.slice(s.indexOf("export const POST"));
      const m = /roles:\s*\[([^\]]*)\]/.exec(post);
      expect(m, file).not.toBeNull();
      const roles = m![1].split(",").map((r) => r.trim().replace(/"/g, "")).filter(Boolean);
      expect(roles, file).toEqual([...BOOKING_ROLES]);
    }
  });
});

describe("CM-26: every CRM section has its own topbar title", () => {
  const crmDir = join(ROOT, "src/app/[locale]/crm");
  const sections = readdirSync(crmDir).filter(
    (name) =>
      statSync(join(crmDir, name)).isDirectory() &&
      !name.startsWith("(") &&
      !name.startsWith("_"),
  );
  const messages = (locale: string) =>
    JSON.parse(src(`src/messages/${locale}.json`)) as {
      crmShell: { topbar: { sections: Record<string, { title?: string; subtitle?: string }> } };
    };

  it("each route segment is mapped, none falls back to «Ресепшн»", () => {
    expect(sections).toContain("action-center");
    for (const name of sections) {
      expect(CRM_SECTION_KEY[name], name).toBeDefined();
    }
  });

  it("each mapped key has a title and subtitle in ru and uz", () => {
    for (const locale of ["ru", "uz"]) {
      const s = messages(locale).crmShell.topbar.sections;
      for (const key of new Set(Object.values(CRM_SECTION_KEY))) {
        expect(s[key]?.title, `${locale} ${key}`).toBeTruthy();
        expect(s[key]?.subtitle, `${locale} ${key}`).toBeTruthy();
      }
    }
  });

  it("finds the segment after /crm with or without the locale prefix", () => {
    expect(crmSectionKey("/crm/action-center")).toBe("actionCenter");
    expect(crmSectionKey("/uz/crm/online-requests")).toBe("onlineRequests");
    expect(crmSectionKey("/uz/crm/me/security")).toBe("account");
    expect(crmSectionKey("/crm/cases/abc")).toBe("patients");
    expect(crmSectionKey("/crm")).toBe("reception");
    expect(crmSectionKey("/crm/unknown")).toBe("reception");
  });
});
