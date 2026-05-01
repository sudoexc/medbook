/**
 * Phase 9c — Active-branch cookie helpers.
 *
 * Pure-string tests. The cookie itself is plain (clinicId is the trust
 * boundary, not the cookie value), so the helpers only need to round-trip
 * a value through the `Cookie:` header and produce a correct
 * `Set-Cookie` directive.
 */
import { describe, it, expect } from "vitest";

import {
  ACTIVE_BRANCH_COOKIE_NAME,
  buildActiveBranchSetCookie,
  readActiveBranchFromCookieHeader,
} from "@/server/platform/branch-cookie";

describe("readActiveBranchFromCookieHeader", () => {
  it("returns null for empty / missing header", () => {
    expect(readActiveBranchFromCookieHeader(null)).toBeNull();
    expect(readActiveBranchFromCookieHeader(undefined)).toBeNull();
    expect(readActiveBranchFromCookieHeader("")).toBeNull();
  });

  it("returns the branchId from a single cookie", () => {
    const header = `${ACTIVE_BRANCH_COOKIE_NAME}=br_main`;
    expect(readActiveBranchFromCookieHeader(header)).toBe("br_main");
  });

  it("returns the branchId when surrounded by other cookies", () => {
    const header = `theme=dark; ${ACTIVE_BRANCH_COOKIE_NAME}=br_xyz; lang=ru`;
    expect(readActiveBranchFromCookieHeader(header)).toBe("br_xyz");
  });

  it("returns null when cookie is present but empty (cleared)", () => {
    const header = `${ACTIVE_BRANCH_COOKIE_NAME}=`;
    expect(readActiveBranchFromCookieHeader(header)).toBeNull();
  });

  it("decodes percent-encoded values", () => {
    const header = `${ACTIVE_BRANCH_COOKIE_NAME}=${encodeURIComponent("br with space")}`;
    expect(readActiveBranchFromCookieHeader(header)).toBe("br with space");
  });
});

describe("buildActiveBranchSetCookie", () => {
  it("sets a 30-day Max-Age + HttpOnly + SameSite=Lax on a real value", () => {
    const v = buildActiveBranchSetCookie("br_main", { secure: false });
    expect(v).toContain(`${ACTIVE_BRANCH_COOKIE_NAME}=br_main`);
    expect(v).toContain("HttpOnly");
    expect(v).toContain("SameSite=Lax");
    expect(v).toContain("Max-Age=2592000"); // 30 days in seconds
    expect(v).not.toContain("Secure");
  });

  it("expires immediately when clearing (branchId=null)", () => {
    const v = buildActiveBranchSetCookie(null, { secure: false });
    expect(v).toContain(`${ACTIVE_BRANCH_COOKIE_NAME}=`);
    expect(v).toContain("Max-Age=0");
  });

  it("includes Secure when the secure option is true", () => {
    const v = buildActiveBranchSetCookie("br_main", { secure: true });
    expect(v).toContain("Secure");
  });
});
