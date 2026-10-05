/**
 * Per-account start page (owner request 05.10.2026): the clinic's iPad
 * reception account opens straight into /crm/reception/tablet, after sign-in
 * and whenever it opens the CRM root; «Обычный режим» still reaches the
 * desktop reception; every other account is unaffected.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isStartPageEntry,
  overrideCookieValue,
  parseStartPage,
  planStartPageUpdate,
  startPageFor,
  startPagePath,
} from "@/lib/start-page";
import { homeForRole, safeCallbackOrHome } from "@/lib/post-login-redirect";
import { startPageDecision } from "@/server/auth/staff-redirects";
import { UpdateUserSchema } from "@/server/schemas/user";

const ROOT = path.resolve(__dirname, "../..");
const TABLET = "reception-tablet";

describe("which start page applies", () => {
  it("only whitelisted values count", () => {
    expect(parseStartPage(TABLET)).toBe(TABLET);
    expect(parseStartPage("crm/reception/tablet")).toBeNull();
    expect(parseStartPage("https://evil.example")).toBeNull();
    expect(parseStartPage("")).toBeNull();
    expect(parseStartPage(null)).toBeNull();
    expect(parseStartPage(42)).toBeNull();
  });

  it("the tablet page is a start page for reception accounts only", () => {
    expect(startPageFor("RECEPTIONIST", TABLET)).toBe(TABLET);
    for (const role of ["ADMIN", "SUPER_ADMIN", "DOCTOR", "NURSE", "CALL_OPERATOR", undefined]) {
      expect(startPageFor(role, TABLET), String(role)).toBeNull();
    }
    expect(startPageFor("RECEPTIONIST", null)).toBeNull();
    expect(startPageFor("RECEPTIONIST", "evil")).toBeNull();
  });

  it("builds the locale-aware path", () => {
    expect(startPagePath(TABLET, "ru")).toBe("/ru/crm/reception/tablet");
    expect(startPagePath(TABLET, "uz")).toBe("/uz/crm/reception/tablet");
    expect(startPagePath(TABLET, "en")).toBe("/ru/crm/reception/tablet");
  });

  it("only the bare CRM entry, without a query, means «open the CRM»", () => {
    expect(isStartPageEntry("crm", "", "")).toBe(true);
    expect(isStartPageEntry("crm", "reception", "")).toBe(true);
    expect(isStartPageEntry("crm", "reception/", "?")).toBe(true);
    expect(isStartPageEntry("crm", "reception", "?mode=desktop")).toBe(false);
    expect(isStartPageEntry("crm", "reception", "?ap=a1")).toBe(false);
    expect(isStartPageEntry("crm", "patients", "")).toBe(false);
    expect(isStartPageEntry("crm", "reception/tablet", "")).toBe(false);
    expect(isStartPageEntry("doctor", "", "")).toBe(false);
  });
});

describe("post-login redirect", () => {
  it("the iPad account lands on the tablet page, in its language", () => {
    expect(homeForRole("RECEPTIONIST", "ru", TABLET)).toBe("/ru/crm/reception/tablet");
    expect(homeForRole("RECEPTIONIST", "uz", TABLET)).toBe("/uz/crm/reception/tablet");
    expect(safeCallbackOrHome(null, "RECEPTIONIST", "uz", TABLET)).toBe("/uz/crm/reception/tablet");
  });

  it("other accounts keep their role's home", () => {
    expect(homeForRole("RECEPTIONIST", "ru")).toBe("/ru/crm");
    expect(homeForRole("RECEPTIONIST", "ru", null)).toBe("/ru/crm");
    expect(homeForRole("ADMIN", "uz", TABLET)).toBe("/uz/crm");
    expect(homeForRole("DOCTOR", "ru", TABLET)).toBe("/ru/doctor");
    expect(homeForRole("SUPER_ADMIN", "ru", TABLET)).toBe("/admin/clinics");
    expect(homeForRole("RECEPTIONIST", "ru", "evil")).toBe("/ru/crm");
  });

  it("a callback to the bare CRM entry opens the start page instead", () => {
    for (const cb of ["/ru/crm", "/ru/crm/", "/ru/crm/reception", "/uz/crm/reception"]) {
      expect(safeCallbackOrHome(cb, "RECEPTIONIST", "ru", TABLET), cb).toBe(
        "/ru/crm/reception/tablet",
      );
    }
  });

  it("a safe callback elsewhere in the CRM is still honoured", () => {
    expect(safeCallbackOrHome("/ru/crm/patients/p1", "RECEPTIONIST", "ru", TABLET)).toBe(
      "/ru/crm/patients/p1",
    );
    expect(safeCallbackOrHome("/uz/crm/reception?ap=a1", "RECEPTIONIST", "uz", TABLET)).toBe(
      "/uz/crm/reception?ap=a1",
    );
    // The deliberate switch to the desktop reception survives a sign-in.
    expect(
      safeCallbackOrHome("/ru/crm/reception?mode=desktop", "RECEPTIONIST", "ru", TABLET),
    ).toBe("/ru/crm/reception?mode=desktop");
    expect(safeCallbackOrHome("/ru/crm/reception/tablet", "RECEPTIONIST", "ru", TABLET)).toBe(
      "/ru/crm/reception/tablet",
    );
  });

  it("hostile or cross-surface callbacks fall back to the start page", () => {
    for (const cb of ["//evil.example/crm", "https://evil.example", "javascript:alert(1)", "/ru/doctor/patients", "/admin/clinics"]) {
      expect(safeCallbackOrHome(cb, "RECEPTIONIST", "ru", TABLET), cb).toBe(
        "/ru/crm/reception/tablet",
      );
    }
  });

  it("without a start page the bare entry callback is honoured as before", () => {
    expect(safeCallbackOrHome("/ru/crm/reception", "RECEPTIONIST", "ru")).toBe("/ru/crm/reception");
    expect(safeCallbackOrHome("/ru/crm", "ADMIN", "ru", TABLET)).toBe("/ru/crm");
  });
});

describe("the proxy's start page step", () => {
  const ipad = {
    surface: "crm" as const,
    role: "RECEPTIONIST",
    startPage: TABLET,
    sessionId: "s1",
    overrideCookie: null as string | null,
  };

  it("sends the bare CRM entry to the tablet page", () => {
    for (const subpath of ["", "reception", "reception/"]) {
      expect(startPageDecision({ ...ipad, subpath, search: "" }), subpath).toEqual({
        kind: "redirect",
        target: "crm/reception/tablet",
      });
    }
  });

  it("leaves deeper pages and links with a query alone", () => {
    expect(startPageDecision({ ...ipad, subpath: "patients", search: "" })).toBeNull();
    expect(startPageDecision({ ...ipad, subpath: "reception", search: "?ap=a1" })).toBeNull();
    expect(startPageDecision({ ...ipad, subpath: "reception", search: "?walkin=true" })).toBeNull();
    expect(startPageDecision({ ...ipad, surface: "doctor", subpath: "", search: "" })).toBeNull();
  });

  it("«Обычный режим» lets the desktop reception through and remembers it for this sign-in", () => {
    expect(startPageDecision({ ...ipad, subpath: "reception", search: "?mode=desktop" })).toEqual({
      kind: "remember-desktop",
      value: "s1",
    });
    // Already remembered: nothing to write again.
    expect(
      startPageDecision({ ...ipad, subpath: "reception", search: "?mode=desktop", overrideCookie: "s1" }),
    ).toBeNull();
    // With the switch remembered, the sidebar's «Ресепшн» stays on the desktop page.
    expect(startPageDecision({ ...ipad, subpath: "reception", search: "", overrideCookie: "s1" })).toBeNull();
    expect(startPageDecision({ ...ipad, subpath: "", search: "", overrideCookie: "s1" })).toBeNull();
  });

  it("a switch made in another sign-in does not count", () => {
    expect(
      startPageDecision({ ...ipad, subpath: "reception", search: "", overrideCookie: "old-session" }),
    ).toEqual({ kind: "redirect", target: "crm/reception/tablet" });
  });

  it("back on the tablet page, the switch is forgotten", () => {
    expect(
      startPageDecision({ ...ipad, subpath: "reception/tablet", search: "", overrideCookie: "s1" }),
    ).toEqual({ kind: "forget-desktop" });
    expect(startPageDecision({ ...ipad, subpath: "reception/tablet", search: "" })).toBeNull();
  });

  it("never touches accounts without a start page, not even with ?mode=desktop", () => {
    for (const who of [
      { role: "RECEPTIONIST", startPage: null },
      { role: "ADMIN", startPage: TABLET },
      { role: "DOCTOR", startPage: TABLET },
      { role: "RECEPTIONIST", startPage: "evil" },
    ]) {
      for (const [subpath, search] of [
        ["", ""],
        ["reception", ""],
        ["reception", "?mode=desktop"],
        ["reception/tablet", ""],
      ] as const) {
        expect(
          startPageDecision({ ...ipad, ...who, subpath, search, overrideCookie: "s1" }),
          `${who.role} ${who.startPage} ${subpath}${search}`,
        ).toBeNull();
      }
    }
  });

  it("a session minted before JWTs carried their row id still gets a working switch", () => {
    expect(overrideCookieValue(null)).toBe("1");
    expect(
      startPageDecision({ ...ipad, sessionId: null, subpath: "reception", search: "?mode=desktop" }),
    ).toEqual({ kind: "remember-desktop", value: "1" });
    expect(
      startPageDecision({ ...ipad, sessionId: null, subpath: "reception", search: "", overrideCookie: "1" }),
    ).toBeNull();
  });

  it("the proxy runs the step, and the tablet's exit link asks for the desktop mode", () => {
    const proxy = readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
    expect(proxy).toContain("startPageDecision(");
    expect(proxy).toContain("START_PAGE_OVERRIDE_COOKIE");
    const tablet = readFileSync(
      path.join(ROOT, "src/app/[locale]/crm/reception/tablet/_components/tablet-app.tsx"),
      "utf8",
    );
    expect(tablet).toContain('href="/crm/reception?mode=desktop"');
  });

  it("both login forms pass the start page to the redirect", () => {
    for (const f of ["src/app/login/page.tsx", "src/app/login/2fa/_components/two-fa-form.tsx"]) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(src, f).toContain("session?.user?.startPage");
    }
  });
});

describe("users API: startPage validation", () => {
  it("the schema accepts a whitelisted value, null, or nothing", () => {
    expect(UpdateUserSchema.safeParse({ startPage: TABLET }).success).toBe(true);
    expect(UpdateUserSchema.safeParse({ startPage: null }).success).toBe(true);
    expect(UpdateUserSchema.safeParse({}).success).toBe(true);
  });

  it("the schema refuses anything else", () => {
    for (const v of ["", "evil", "/crm/reception/tablet", 1, true, ["reception-tablet"]]) {
      expect(UpdateUserSchema.safeParse({ startPage: v }).success, JSON.stringify(v)).toBe(false);
    }
  });

  it("stores the tablet page for a reception account", () => {
    expect(planStartPageUpdate({ nextRole: "RECEPTIONIST", current: null, requested: TABLET })).toEqual({
      ok: true,
      write: true,
      value: TABLET,
    });
    expect(planStartPageUpdate({ nextRole: "RECEPTIONIST", current: TABLET, requested: TABLET })).toEqual({
      ok: true,
      write: false,
    });
  });

  it("refuses it for any other role, judged by the role after the edit", () => {
    for (const role of ["ADMIN", "DOCTOR", "NURSE", "CALL_OPERATOR", "SUPER_ADMIN"]) {
      expect(planStartPageUpdate({ nextRole: role, current: null, requested: TABLET }), role).toEqual({
        ok: false,
        reason: "start_page_not_allowed",
      });
    }
  });

  it("clears it on request, and when the account leaves the reception role", () => {
    expect(planStartPageUpdate({ nextRole: "RECEPTIONIST", current: TABLET, requested: null })).toEqual({
      ok: true,
      write: true,
      value: null,
    });
    expect(planStartPageUpdate({ nextRole: "RECEPTIONIST", current: null, requested: null })).toEqual({
      ok: true,
      write: false,
    });
    expect(planStartPageUpdate({ nextRole: "NURSE", current: TABLET, requested: undefined })).toEqual({
      ok: true,
      write: true,
      value: null,
    });
    // A value nobody honours any more is cleaned up on the next save too.
    expect(planStartPageUpdate({ nextRole: "RECEPTIONIST", current: "gone", requested: undefined })).toEqual({
      ok: true,
      write: true,
      value: null,
    });
  });

  it("an edit that does not mention it leaves it alone", () => {
    expect(planStartPageUpdate({ nextRole: "RECEPTIONIST", current: TABLET, requested: undefined })).toEqual({
      ok: true,
      write: false,
    });
    expect(planStartPageUpdate({ nextRole: "ADMIN", current: null, requested: undefined })).toEqual({
      ok: true,
      write: false,
    });
  });
});

describe("ops script and i18n", () => {
  it("scripts/set-start-page.ts ships to the worker and is a dry run by default", () => {
    const allow = readFileSync(path.join(ROOT, "scripts/worker-allowlist.txt"), "utf8")
      .split("\n")
      .map((l) => l.trim());
    expect(allow).toContain("set-start-page.ts");
    const src = readFileSync(path.join(ROOT, "scripts/set-start-page.ts"), "utf8");
    expect(src).toMatch(/const APPLY = process\.env\.APPLY === "1"/);
    expect(src).toContain("DRY RUN");
    expect(src).toContain("startPageAllowedFor");
  });

  it("ru and uz carry the same new keys, with no dashes", () => {
    const keys = [
      "startPage",
      "startPageDefault",
      "startPageTablet",
      "startPageHint",
      "startPageBadge",
      "startPageNotAllowed",
    ];
    for (const loc of ["ru", "uz"]) {
      const msgs = JSON.parse(readFileSync(path.join(ROOT, `src/messages/${loc}.json`), "utf8"));
      for (const k of keys) {
        const v = msgs.settings.users[k];
        expect(typeof v, `${loc}.${k}`).toBe("string");
        expect(v, `${loc}.${k}`).not.toMatch(/[‒-―-]/);
      }
    }
  });
});

describe("the migration", () => {
  const dir = readdirSync(path.join(ROOT, "prisma/migrations")).find((n) =>
    /^\d{14}_user_start_page$/.test(n),
  );

  it("sits in its slot of the day and only adds a nullable column", () => {
    expect(dir).toBeDefined();
    const ts = Number(dir!.slice(0, 14));
    expect(ts).toBeGreaterThanOrEqual(20261005100000);
    expect(ts).toBeLessThanOrEqual(20261005199999);
    const sql = readFileSync(path.join(ROOT, "prisma/migrations", dir!, "migration.sql"), "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("--"))
      .join("\n")
      .trim();
    expect(sql).toBe('ALTER TABLE "User" ADD COLUMN     "startPage" TEXT;');
    const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/\n\s+startPage String\?\n/);
  });
});
